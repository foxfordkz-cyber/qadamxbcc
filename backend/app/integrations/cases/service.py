"""Locked, versioned case mutations; no transfer or Telegram side effects."""

import base64
import hashlib
import hmac
import uuid
from datetime import datetime, timedelta
from typing import Any

from pydantic import BaseModel
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.integrations.cases.models import CaseContent, CaseEvent, FraudCase
from app.integrations.cases.policy_review import compare_policies
from app.integrations.cases.schemas import (
    LABELS,
    OUTCOME_REASONS,
    QUESTIONS,
    Action,
    AnswerInformation,
    CaseAnalytics,
    CaseOut,
    CasePage,
    InformationOut,
)
from app.integrations.errors import IntegrationError
from app.integrations.guardian_reports import report_output
from app.integrations.models import GuardianReport
from app.integrations.security import Principal

TRANSITIONS = {
    "NEW": {"IN_REVIEW", "ESCALATED", "CLOSED"},
    "IN_REVIEW": {"ESCALATED", "RESOLVED", "CLOSED"},
    "NEEDS_INFORMATION": {"IN_REVIEW", "ESCALATED", "CLOSED"},
    "ESCALATED": {"IN_REVIEW", "RESOLVED", "CLOSED"},
    "RESOLVED": {"IN_REVIEW", "CLOSED"},
    "CLOSED": {"IN_REVIEW"},
}


def digest(body: BaseModel, actor: Principal) -> str:
    return hashlib.sha256((actor.model_dump_json() + body.model_dump_json()).encode()).hexdigest()


async def get_case(session: AsyncSession, cid: uuid.UUID, *, lock: bool = False) -> FraudCase:
    query = select(FraudCase).where(FraudCase.id == cid).execution_options(populate_existing=True)
    row = await session.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise IntegrationError(404, "case_not_found")
    if row.expires_at <= utcnow():
        raise IntegrationError(410, "case_expired")
    return row


async def prior_event(
    session: AsyncSession, cid: uuid.UUID, key: uuid.UUID, request_hash: str
) -> CaseEvent | None:
    prior = await session.scalar(
        select(CaseEvent).where(CaseEvent.case_id == cid, CaseEvent.key == key)
    )
    if prior and prior.request_hash != request_hash:
        raise IntegrationError(409, "case_idempotency_conflict")
    return prior


async def save_event(
    session: AsyncSession,
    row: FraudCase,
    actor: Principal,
    key: uuid.UUID,
    request_hash: str,
    code: str,
    *,
    body: str | None = None,
    question: str | None = None,
    reply_to: uuid.UUID | None = None,
    reason: str | None = None,
) -> CaseOut:
    result = CaseOut.model_validate(row)
    event = CaseEvent(
        id=uuid.uuid4(),
        case_id=row.id,
        version=row.version,
        key=key,
        actor_id=actor.subject,
        actor_role=actor.role,
        request_hash=request_hash,
        code=code,
        state=row.state,
        result={"case": result.model_dump(mode="json"), "reason": reason},
        question=question,
        reply_to=reply_to,
    )
    try:
        session.add(event)
        await session.flush()
        if body is not None:
            session.add(
                CaseContent(
                    event_id=event.id,
                    body=body,
                    expires_at=min(row.expires_at, utcnow() + timedelta(days=7)),
                )
            )
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise IntegrationError(409, "case_write_conflict") from None
    return result


async def open_case(
    session: AsyncSession,
    report_id: uuid.UUID,
    actor: Principal,
    key: uuid.UUID,
    request_hash: str,
) -> CaseOut:
    # Same-source creation serialized by the existing report row; unique constraint is a backstop.
    report = await session.scalar(
        select(GuardianReport).where(GuardianReport.id == report_id).with_for_update()
    )
    if report is None:
        raise IntegrationError(404, "incident_not_found")
    report_output(report)
    prior = await session.scalar(select(FraudCase).where(FraudCase.report_id == report_id))
    if prior:
        await get_case(session, prior.id)
        event = await prior_event(session, prior.id, key, request_hash)
        if event:
            return CaseOut.model_validate(event.result["case"])
        raise IntegrationError(409, "case_already_exists")
    now = utcnow()
    row = FraudCase(
        id=uuid.uuid4(),
        report_id=report_id,
        source=report.source,
        category=report.category,
        state="NEW",
        version=1,
        created_at=now,
        status_since=now,
        expires_at=now + timedelta(days=30),
    )
    session.add(row)
    await session.flush()
    return await save_event(session, row, actor, key, request_hash, "OPENED")


async def owner_report(session: AsyncSession, report_id: uuid.UUID) -> GuardianReport:
    report = await session.get(GuardianReport, report_id)
    if report is None or report.contact_id is not None:
        raise IntegrationError(409, "case_information_channel_unavailable")
    report_output(report)
    return report


async def mutate(
    session: AsyncSession, cid: uuid.UUID, actor: Principal, key: uuid.UUID, body: Action
) -> CaseOut:
    row = await get_case(session, cid, lock=True)
    request_hash = digest(body, actor)
    prior = await prior_event(session, cid, key, request_hash)
    if prior:
        return CaseOut.model_validate(prior.result["case"])
    if row.version != body.expected_version:
        raise IntegrationError(409, "case_version_conflict")
    if row.version >= 500:
        raise IntegrationError(409, "case_action_limit")
    if body.action == "transition":
        if body.reason in OUTCOME_REASONS and body.state != "CLOSED":
            raise IntegrationError(409, "case_transition_not_permitted")
        if body.state not in TRANSITIONS[row.state]:
            raise IntegrationError(409, "case_transition_not_permitted")
        if row.state == "CLOSED" and body.reason != "reopened":
            raise IntegrationError(409, "case_reopen_reason_required")
        row.state, row.status_since = body.state, utcnow()
    else:
        if row.state in {"CLOSED", "RESOLVED"}:
            raise IntegrationError(409, "case_reopen_required")
        if body.action == "assign":
            row.assignee = body.assignee
        elif body.action == "categorize":
            row.category = body.category
        elif body.action == "request_information":
            await owner_report(session, row.report_id)
            if row.state not in {"IN_REVIEW", "ESCALATED"}:
                raise IntegrationError(409, "case_transition_not_permitted")
            if any(not item.answered for item in await information(session, row)):
                raise IntegrationError(409, "case_information_pending")
            row.state, row.status_since = "NEEDS_INFORMATION", utcnow()
    row.version += 1
    return await save_event(
        session,
        row,
        actor,
        key,
        request_hash,
        body.action.upper(),
        body=body.body if body.action == "note" else None,
        question=body.question if body.action == "request_information" else None,
        reason=body.reason if body.action == "transition" else None,
    )


async def information(session: AsyncSession, row: FraudCase) -> list[InformationOut]:
    events = list(
        await session.scalars(
            select(CaseEvent)
            .where(
                CaseEvent.case_id == row.id,
                CaseEvent.code.in_(["REQUEST_INFORMATION", "INFORMATION_RECEIVED"]),
            )
            .order_by(CaseEvent.version)
        )
    )
    answered = {event.reply_to for event in events if event.reply_to}
    return [
        InformationOut.model_validate(
            {
                "id": e.id,
                "question": e.question,
                "description_ru": QUESTIONS[e.question][0],
                "description_kk": QUESTIONS[e.question][1],
                "created_at": e.created_at,
                "answered": e.id in answered,
            }
        )
        for e in events
        if e.question
    ]


async def owned_case(
    session: AsyncSession, report_id: uuid.UUID, actor: Principal, *, lock: bool = False
) -> FraudCase:
    report = await session.get(GuardianReport, report_id)
    if report is None or report.owner_id != actor.subject or report.contact_id is not None:
        raise IntegrationError(404, "incident_not_found")
    report_output(report)
    cid = await session.scalar(select(FraudCase.id).where(FraudCase.report_id == report_id))
    if cid is None:
        raise IntegrationError(404, "case_not_found")
    return await get_case(session, cid, lock=lock)


async def answer(
    session: AsyncSession,
    row: FraudCase,
    request_id: uuid.UUID,
    actor: Principal,
    key: uuid.UUID,
    body: AnswerInformation,
) -> None:
    request_hash = hashlib.sha256((str(request_id) + digest(body, actor)).encode()).hexdigest()
    if await prior_event(session, row.id, key, request_hash):
        return
    request = await session.get(CaseEvent, request_id)
    if request is None or request.case_id != row.id or request.code != "REQUEST_INFORMATION":
        raise IntegrationError(404, "case_information_not_found")
    answered = await session.scalar(select(CaseEvent.id).where(CaseEvent.reply_to == request_id))
    if answered:
        raise IntegrationError(409, "case_information_already_answered")
    # An officer may resume review or escalate while awaiting the owner. That
    # administrative transition does not retract an already-issued question.
    # Keep it answerable until the case is resolved/closed, without changing the
    # officer's chosen state when the reply arrives.
    if row.state not in {"IN_REVIEW", "NEEDS_INFORMATION", "ESCALATED"} or row.version >= 500:
        raise IntegrationError(409, "case_information_closed")
    row.version += 1
    await save_event(
        session,
        row,
        actor,
        key,
        request_hash,
        "INFORMATION_RECEIVED",
        body=body.body,
        reply_to=request_id,
    )


def cursor_encode(row: FraudCase, key: str, subject: uuid.UUID) -> str:
    payload = f"cases:{subject}:{row.created_at.isoformat()}|{row.id}".encode()
    signature = hmac.new(key.encode(), payload, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(signature + payload).decode()


async def page(
    session: AsyncSession, limit: int, cursor: str | None, key: str, subject: uuid.UUID
) -> CasePage:
    query = select(FraudCase).where(FraudCase.expires_at > utcnow())
    if cursor:
        try:
            raw = base64.b64decode(cursor, altchars=b"-_", validate=True)
            payload = raw[32:]
            if not hmac.compare_digest(
                raw[:32], hmac.new(key.encode(), payload, hashlib.sha256).digest()
            ):
                raise ValueError
            prefix = f"cases:{subject}:"
            decoded = payload.decode()
            if not decoded.startswith(prefix):
                raise ValueError
            stamp, identifier = decoded[len(prefix) :].split("|")
            timestamp, cid = datetime.fromisoformat(stamp), uuid.UUID(identifier)
            query = query.where(
                or_(
                    FraudCase.created_at < timestamp,
                    and_(
                        FraudCase.created_at == timestamp,
                        FraudCase.id < cid,
                    ),
                )
            )
        except (ValueError, UnicodeError):
            raise IntegrationError(400, "case_cursor_invalid") from None
    rows = list(
        await session.scalars(
            query.order_by(FraudCase.created_at.desc(), FraudCase.id.desc()).limit(limit + 1)
        )
    )
    return CasePage(
        items=[CaseOut.model_validate(row) for row in rows[:limit]],
        next_cursor=cursor_encode(rows[limit - 1], key, subject) if len(rows) > limit else None,
    )


async def analytics(session: AsyncSession) -> CaseAnalytics:
    now = utcnow()
    valid = FraudCase.expires_at > now
    states = {
        state: int(count)
        for state, count in (
            await session.execute(
                select(FraudCase.state, func.count()).where(valid).group_by(FraudCase.state)
            )
        ).all()
    }
    sources = {
        source: int(count)
        for source, count in (
            await session.execute(
                select(FraudCase.source, func.count()).where(valid).group_by(FraudCase.source)
            )
        ).all()
    }

    async def count_ever(states: set[str]) -> int:
        return int(
            await session.scalar(
                select(func.count(func.distinct(CaseEvent.case_id)))
                .join(FraudCase, FraudCase.id == CaseEvent.case_id)
                .where(valid, CaseEvent.state.in_(states))
            )
            or 0
        )

    reviewed = await count_ever({"IN_REVIEW", "NEEDS_INFORMATION", "ESCALATED", "RESOLVED"})
    escalated = await count_ever({"ESCALATED"})
    oldest = {
        state: max(0.0, (now - stamp).total_seconds())
        for state, stamp in (
            await session.execute(
                select(FraudCase.state, func.min(FraudCase.status_since))
                .where(valid)
                .group_by(FraudCase.state)
            )
        ).all()
    }
    total = sum(states.values())
    return CaseAnalytics(
        as_of=now,
        total=total,
        open=total - states.get("CLOSED", 0),
        closed=states.get("CLOSED", 0),
        by_state=states,
        by_source=sources,
        escalated_cases=escalated,
        manually_reviewed_cases=reviewed,
        manual_review_share=reviewed / total if total else 0.0,
        oldest_current_status_seconds=oldest,
        policy_comparison=await compare_policies(session, now),
    )


def event_output(event: CaseEvent) -> dict[str, Any]:
    ru, kk = LABELS[event.code]
    return {
        "id": event.id,
        "actor_id": event.actor_id,
        "version": event.version,
        "code": event.code,
        "actor_role": event.actor_role,
        "timestamp": event.created_at,
        "state": event.result["case"]["state"],
        "category": event.result["case"]["category"],
        "assignee": event.result["case"]["assignee"],
        "reason": event.result["reason"],
        "description_ru": ru,
        "description_kk": kk,
    }


async def expire_cases(session: AsyncSession) -> None:
    """Bounded privacy cleanup; audit is append-only until its explicit 30-day expiry."""
    now = utcnow()
    ids = list(
        await session.scalars(
            select(CaseContent.event_id).where(CaseContent.expires_at <= now).limit(100)
        )
    )
    if ids:
        await session.execute(delete(CaseContent).where(CaseContent.event_id.in_(ids)))
    cases = list(
        await session.scalars(select(FraudCase.id).where(FraudCase.expires_at <= now).limit(100))
    )
    if cases:
        # Explicit order also enforces retention in portable SQLite without FK pragmas.
        events = select(CaseEvent.id).where(CaseEvent.case_id.in_(cases))
        await session.execute(delete(CaseContent).where(CaseContent.event_id.in_(events)))
        await session.execute(delete(CaseEvent).where(CaseEvent.case_id.in_(cases)))
        await session.execute(delete(FraudCase).where(FraudCase.id.in_(cases)))
    await session.commit()

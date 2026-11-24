"""Authenticated, case-bound callback invitations in the synthetic wallet.

Consent is a case event. It never dials a phone, verifies a caller, or releases money.
"""

import hashlib
from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import SessionDep
from app.db.base import utcnow
from app.integrations.capabilities import Principal
from app.integrations.cases.models import CaseEvent, FraudCase
from app.integrations.cases.schemas import OUTCOME_REASONS
from app.integrations.cases.service import prior_event, save_event
from app.integrations.errors import IntegrationError
from app.integrations.models import GuardianReport
from app.mobile_gateway.app import IdentityDep
from app.mobile_gateway.config import MobileSettings
from app.mobile_gateway.wallet import balance, money
from app.models import Transaction, TransactionStatus

ASKED = "CALLBACK_OWNER_REQUESTED"
INVITED = "CALLBACK_INVITED"
ACCEPTED = "CALLBACK_ACCEPTED"
DECLINED = "CALLBACK_DECLINED"
CALLBACK_CODES = (ASKED, INVITED, ACCEPTED, DECLINED)
INVITATION_TTL = timedelta(minutes=15)
ASSIGNEE = "demo_analyst_a"
TERMINAL = {"RESOLVED", "CLOSED"}
Key = Annotated[UUID, Header(alias="Idempotency-Key")]
Status = Literal["customer_requested", "requested", "accepted", "declined", "expired"]


class Callback(BaseModel):
    id: UUID
    case_id: UUID
    report_id: UUID
    transaction_id: UUID | None
    status: Status
    reason: Literal["transfer_review"] = "transfer_review"
    department: Literal["antifraud"] = "antifraud"
    requested_at: datetime
    expires_at: datetime
    answered_at: datetime | None
    demonstration_only: Literal[True] = True


class CaseCallback(BaseModel):
    case_id: UUID
    case_state: str
    callback: Callback | None


class ReviewedTransfer(BaseModel):
    transaction_id: UUID
    amount: str
    currency: str
    status: TransactionStatus


class CaseResolution(BaseModel):
    outcome: Literal["confirmed_fraud", "legitimate_transfer", "insufficient_evidence"] | None
    closed_at: datetime
    operation: ReviewedTransfer | None
    balance: str


class OwnerCaseView(CaseCallback):
    resolution: CaseResolution | None = None


class CallbackList(BaseModel):
    items: list[Callback]


class RequestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Invite(RequestBody):
    expected_version: int = Field(ge=1, strict=True)


class Answer(RequestBody):
    answer: Literal["accepted", "declined"]


def case_query(now: datetime) -> Select[FraudCase, GuardianReport]:
    return (
        select(FraudCase, GuardianReport)
        .join(GuardianReport, GuardianReport.id == FraudCase.report_id)
        .where(
            FraudCase.expires_at > now,
            GuardianReport.expires_at > now,
            FraudCase.source.in_(("owner_demo", "guardian_timeout", "guardian_signal")),
            GuardianReport.contact_id.is_(None),
            GuardianReport.description.is_not(None),
        )
    )


async def case_for(
    db: AsyncSession,
    *,
    cid: UUID | None = None,
    report_id: UUID | None = None,
    owner: UUID | None = None,
    lock: bool = False,
) -> tuple[FraudCase, GuardianReport]:
    query = case_query(utcnow())
    if cid is not None:
        query = query.where(FraudCase.id == cid)
    if report_id is not None:
        query = query.where(GuardianReport.id == report_id)
    if owner is not None:
        query = query.where(GuardianReport.owner_id == owner)
    if lock:
        query = query.with_for_update(of=FraudCase)
    record = (await db.execute(query)).one_or_none()
    if record is None:
        raise HTTPException(404, "callback_case_unavailable")
    return record[0], record[1]


async def history(db: AsyncSession, case_ids: Sequence[UUID]) -> dict[UUID, list[CaseEvent]]:
    grouped: dict[UUID, list[CaseEvent]] = {cid: [] for cid in case_ids}
    for event in await db.scalars(
        select(CaseEvent)
        .where(
            CaseEvent.case_id.in_(case_ids),
            CaseEvent.code.in_((*CALLBACK_CODES, "ASSIGN", "TRANSITION")),
        )
        .order_by(CaseEvent.case_id, CaseEvent.version)
    ):
        grouped[event.case_id].append(event)
    return grouped


def callback_state(
    case: FraudCase,
    report: GuardianReport,
    events: Sequence[CaseEvent],
    now: datetime,
    *,
    at_version: int | None = None,
) -> Callback | None:
    if at_version is not None:
        events = [e for e in events if e.version <= at_version]
    first = next(
        (e for e in reversed(events) if e.code in (ASKED, INVITED) and e.reply_to is None), None
    )
    if first is None:
        return None
    events = [e for e in events if e.version >= first.version]
    actions = [e for e in events if e.code in CALLBACK_CODES]
    last = actions[-1]
    invitation = next((e for e in actions if e.code == INVITED), None)
    valid_until = min(case.expires_at, report.expires_at)
    if invitation is not None:
        valid_until = min(valid_until, invitation.created_at + INVITATION_TTL)
    answered_at = None
    status: Status
    if last.code in (ACCEPTED, DECLINED):
        status = "accepted" if last.code == ACCEPTED else "declined"
        answered_at = last.created_at
    elif valid_until <= now or any(
        (e.version > first.version and e.state in TERMINAL)
        or (
            invitation is not None
            and e.version > invitation.version
            and e.code == "ASSIGN"
            and e.result["case"]["assignee"] != ASSIGNEE
        )
        for e in events
    ):
        status = "expired"
    else:
        status = "requested" if invitation else "customer_requested"
    return Callback(
        id=first.id,
        case_id=case.id,
        report_id=report.id,
        transaction_id=report.transaction_id,
        status=status,
        reason="transfer_review",
        department="antifraud",
        demonstration_only=True,
        requested_at=(invitation or first).created_at,
        expires_at=valid_until,
        answered_at=answered_at,
    )


async def record(
    db: AsyncSession,
    case: FraudCase,
    report: GuardianReport,
    actor: Principal,
    key: UUID,
    body: RequestBody,
    code: str,
    callback_id: UUID | None = None,
) -> Callback:
    events = (await history(db, [case.id]))[case.id]
    current = callback_state(case, report, events, utcnow())
    fingerprint = hashlib.sha256(
        f"{case.id}:{actor.subject}:{actor.role}:{code}:{callback_id}:{body.model_dump_json()}".encode()
    ).hexdigest()
    try:
        prior = await prior_event(db, case.id, key, fingerprint)
        if prior is not None:
            replay = callback_state(
                case, report, events, prior.created_at, at_version=prior.version
            )
            assert replay is not None
            return replay
        if callback_id is not None and (current is None or current.id != callback_id):
            raise HTTPException(409, "callback_not_pending")
        if case.version >= 500 or case.state in TERMINAL:
            raise HTTPException(409, "callback_case_closed")
        if isinstance(body, Invite):
            if body.expected_version != case.version:
                raise HTTPException(409, "case_version_conflict")
            if case.assignee != ASSIGNEE:
                raise HTTPException(403, "callback_assignee_required")
        if code == ASKED and current and current.status not in ("expired", "declined"):
            raise HTTPException(409, "callback_already_exists")
        if code == INVITED and current and current.status != "customer_requested":
            raise HTTPException(409, "callback_already_exists")
        if code in (ACCEPTED, DECLINED) and (current is None or current.status != "requested"):
            raise HTTPException(409, "callback_not_pending")
        # Each invitation has at most one answer via the unique reply_to link.
        # Only an owner's explicit new request can start a fresh chain after expiry or refusal.
        reply_to = (
            None
            if code == ASKED
            else next((e.id for e in reversed(events) if e.code in (ASKED, INVITED)), None)
        )
        case.version += 1
        saved = await save_event(db, case, actor, key, fingerprint, code, reply_to=reply_to)
    except IntegrationError as exc:
        raise HTTPException(exc.status, exc.code) from exc
    updated = callback_state(
        case, report, (await history(db, [case.id]))[case.id], utcnow(), at_version=saved.version
    )
    assert updated is not None
    return updated


def install_callbacks(app: FastAPI, cfg: MobileSettings, enabled: bool) -> None:
    def officer(identity: IdentityDep) -> Principal:
        if identity.role != "admin" or identity.subject != cfg.officer_id:
            raise HTTPException(403, "officer_required")
        if not enabled:
            raise HTTPException(404, "callback_unavailable")
        return Principal(role="soc", subject=identity.subject)

    def customer(identity: IdentityDep) -> Principal:
        if identity.role != "client":
            raise HTTPException(403, "client_required")
        if not enabled:
            raise HTTPException(404, "callback_unavailable")
        return Principal(role="owner", subject=identity.subject)

    officer_route = "/mobile/v1/cases/{case_id}/callback"
    owner_route = "/mobile/v1/reports/{report_id}/callback"

    @app.get(officer_route)
    async def officer_view(
        case_id: UUID,
        session: SessionDep,
        actor: Annotated[Principal, Depends(officer)],
    ) -> CaseCallback:
        case, report = await case_for(session, cid=case_id)
        events = (await history(session, [case_id]))[case_id]
        return CaseCallback(
            case_id=case_id,
            case_state=case.state,
            callback=callback_state(case, report, events, utcnow()),
        )

    @app.post(officer_route)
    async def invite(
        case_id: UUID,
        body: Invite,
        key: Key,
        session: SessionDep,
        actor: Annotated[Principal, Depends(officer)],
    ) -> Callback:
        case, report = await case_for(session, cid=case_id, lock=True)
        return await record(session, case, report, actor, key, body, INVITED)

    @app.get(owner_route, response_model_exclude_unset=True)
    async def owner_view(
        report_id: UUID,
        session: SessionDep,
        actor: Annotated[Principal, Depends(customer)],
    ) -> OwnerCaseView:
        case, report = await case_for(session, report_id=report_id, owner=actor.subject)
        events = (await history(session, [case.id]))[case.id]
        view = OwnerCaseView(
            case_id=case.id,
            case_state=case.state,
            callback=callback_state(case, report, events, utcnow()),
        )
        if case.state == "CLOSED":
            closing = next(
                (
                    e
                    for e in reversed(events)
                    if e.version <= case.version and e.code == "TRANSITION" and e.state == "CLOSED"
                ),
                None,
            )
            reason = closing.result.get("reason") if closing is not None else None
            operation = None
            if report.transaction_id is not None:
                tx = await session.scalar(
                    select(Transaction).where(
                        Transaction.id == report.transaction_id,
                        Transaction.sender_id == actor.subject,
                    )
                )
                if tx is not None:
                    operation = ReviewedTransfer(
                        transaction_id=tx.id,
                        amount=money(tx.amount),
                        currency=tx.currency,
                        status=tx.status,
                    )
            view.resolution = CaseResolution(
                outcome=reason if reason in OUTCOME_REASONS else None,
                closed_at=closing.created_at if closing is not None else case.status_since,
                operation=operation,
                balance=await balance(session, actor.subject),
            )
        return view

    @app.post(owner_route)
    async def request_callback(
        report_id: UUID,
        body: RequestBody,
        key: Key,
        session: SessionDep,
        actor: Annotated[Principal, Depends(customer)],
    ) -> Callback:
        case, report = await case_for(session, report_id=report_id, owner=actor.subject, lock=True)
        return await record(session, case, report, actor, key, body, ASKED)

    @app.get("/mobile/v1/callbacks")
    async def owned_callbacks(
        session: SessionDep,
        actor: Annotated[Principal, Depends(customer)],
    ) -> CallbackList:
        now = utcnow()
        cases = (
            await session.execute(
                case_query(now)
                .where(
                    GuardianReport.owner_id == actor.subject,
                    select(CaseEvent.id)
                    .where(CaseEvent.case_id == FraudCase.id, CaseEvent.code.in_((ASKED, INVITED)))
                    .exists(),
                )
                .order_by(FraudCase.created_at.desc(), FraudCase.id.desc())
                .limit(100)
            )
        ).all()
        grouped = await history(session, [c.id for c, _ in cases])
        return CallbackList(
            items=[
                state
                for case, report in cases
                if (state := callback_state(case, report, grouped[case.id], now))
            ]
        )

    @app.post("/mobile/v1/callbacks/{callback_id}/answer")
    async def answer(
        callback_id: UUID,
        body: Answer,
        key: Key,
        session: SessionDep,
        actor: Annotated[Principal, Depends(customer)],
    ) -> Callback:
        cid = await session.scalar(
            select(CaseEvent.case_id).where(
                CaseEvent.id == callback_id, CaseEvent.code.in_((ASKED, INVITED))
            )
        )
        if cid is None:
            raise HTTPException(404, "callback_case_unavailable")
        case, report = await case_for(session, cid=cid, owner=actor.subject, lock=True)
        code = ACCEPTED if body.answer == "accepted" else DECLINED
        return await record(session, case, report, actor, key, body, code, callback_id)

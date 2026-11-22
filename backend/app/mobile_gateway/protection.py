"""Read existing decisions and contact receipts; safety answers never settle a transfer."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import case, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import EngineDep, SessionDep
from app.db.base import utcnow
from app.db.locks import serialize_sender, serialized_identity
from app.integrations.config import IntegrationSettings
from app.integrations.errors import IntegrationError
from app.integrations.models import ContactNotification, GuardianReport, TrustedContact
from app.integrations.telegram.schemas import ContactState, NotificationState
from app.integrations.telegram.service import TrustedContactService
from app.mobile_gateway.app import Identity, IdentityDep
from app.mobile_gateway.protection_models import FamilyShield, PostCall
from app.models import Account, RiskEvent, Transaction, TransactionStatus
from app.models.family_approval import FamilyApproval, FamilyApprovalPolicy
from app.schemas.transfers import PostCallRequest
from app.services import family_approval
from app.services.transfers import ConflictError, TransferService

QUIET = timedelta(minutes=5)
GRACE = timedelta(hours=24)


class Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: Literal["my_choice", "pressure"]


class Change(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["enable", "disable"]


class ApprovalChange(Change):
    contact_id: UUID | None = None


def client(principal: Identity) -> UUID:
    if principal.role != "client":
        raise HTTPException(403, "client_required")
    return principal.subject


async def owned(db: AsyncSession, txid: UUID, owner: UUID, *, lock: bool = False) -> Transaction:
    stmt = select(Transaction).where(Transaction.id == txid, Transaction.sender_id == owner)
    tx = await db.scalar(stmt.with_for_update() if lock else stmt)
    if tx is None:
        raise HTTPException(404, "transaction_not_found")
    return tx


def enabled(policy: FamilyShield | None, now: datetime) -> bool:
    return bool(policy and (not policy.disable_at or policy.disable_at > now))


@dataclass
class CallCheck:
    ended_at: datetime
    answered_at: datetime | None
    answer: str | None


async def recorded_call(db: AsyncSession, txid: UUID) -> CallCheck | None:
    """Prefer the shared payment audit, retaining answers from older Android installations."""
    codes = ("POST_CALL_ENDED", "POST_CALL_RECOGNIZED", "POST_CALL_SCAM_REPORTED")
    rows = await db.execute(
        select(RiskEvent.rule_code, RiskEvent.created_at).where(
            RiskEvent.transaction_id == txid, RiskEvent.rule_code.in_(codes)
        )
    )
    events = dict(rows.all())
    legacy = await db.get(PostCall, txid)
    ended = events.get(codes[0]) or (legacy.ended_at if legacy else None)
    if ended is None:
        return None
    if codes[2] in events:
        return CallCheck(ended, events[codes[2]], "pressure")
    if codes[1] in events:
        return CallCheck(ended, events[codes[1]], "my_choice")
    return CallCheck(
        ended, legacy.answered_at if legacy else None, legacy.answer if legacy else None
    )


def call_state(tx: Transaction, row: CallCheck | None, now: datetime) -> str:
    if row is None:
        return (
            "on_call" if tx.active_call and tx.status == TransactionStatus.COOLING_OFF else "none"
        )
    if row.answered_at:
        return "answered"
    if tx.status != TransactionStatus.COOLING_OFF:
        return "none"
    return "ready" if row.ended_at + QUIET <= now else "waiting"


@dataclass
class ContactReceipt:
    state: str
    first_queued_at: datetime


async def receipt(db: AsyncSession, tx: Transaction) -> ContactReceipt | None:
    notice = ContactNotification
    # A recorded reply remains significant after the response window closes.
    waiting = notice.state.in_([NotificationState.QUEUED, NotificationState.SENT])
    state = case(
        (waiting & (TrustedContact.state == ContactState.REVOKED), NotificationState.REVOKED.value),
        (waiting & (notice.expires_at <= utcnow()), NotificationState.EXPIRED.value),
        else_=notice.state,
    )
    priority = case(
        {
            NotificationState.SUSPICION: 0,
            NotificationState.ACKNOWLEDGED: 1,
            NotificationState.SENT: 2,
            NotificationState.QUEUED: 3,
        },
        value=state,
        else_=4,
    )
    rows = await db.execute(
        select(state, func.min(notice.created_at).over())
        .select_from(notice)
        .join(TrustedContact, TrustedContact.id == notice.contact_id)
        .where(
            notice.transaction_id == tx.id,
            notice.owner_id == tx.sender_id,
        )
        .order_by(priority, notice.created_at.desc(), notice.id)
        .limit(1)
    )
    row = rows.first()
    return ContactReceipt(row[0], row[1]) if row is not None else None


async def snapshot(db: AsyncSession, tx: Transaction) -> dict[str, Any]:
    now = utcnow()
    row = await recorded_call(db, tx.id)
    notice = await receipt(db, tx)
    policy = await db.get(FamilyShield, tx.sender_id)
    required = any(
        r.get("code") == family_approval.REQUIRED
        for r in (tx.evaluation_snapshot or {}).get("reasons", [])
    )
    state, expires_at = await family_approval.approval_state(db, tx, now, required=required)
    second = None if state == "none" else {"state": state, "expires_at": expires_at}
    return {
        "transaction_id": tx.id,
        "state": call_state(tx, row, now),
        "server_time": now,
        "ready_at": row.ended_at + QUIET if row else None,
        "answer": row.answer if row else None,
        "contact_state": notice.state if notice else None,
        "family_enabled": enabled(policy, now),
        "second_confirmation": second,
    }


def install_protection(app: FastAPI, settings: IntegrationSettings) -> None:
    base = "/mobile/v1/protection"

    def eligible(contact: TrustedContact, owner: UUID) -> bool:
        chat = contact.telegram_chat_id
        if not (chat and chat.isdecimal()):
            return False
        return (
            contact.owner_id == owner
            and contact.state == "CONTACT_VERIFIED"
            and contact.contact_consented_at is not None
            and contact.notifications_enabled
            and settings.approval_chat_allowed(owner, int(chat))
        )

    @app.get(base + "/second-confirmation")
    async def second_confirmation(principal: IdentityDep, session: SessionDep) -> dict[str, Any]:
        owner = client(principal)
        policy = await session.get(FamilyApprovalPolicy, owner)
        contacts = await session.scalars(
            select(TrustedContact)
            .where(TrustedContact.owner_id == owner, TrustedContact.state == "CONTACT_VERIFIED")
            .order_by(TrustedContact.created_at, TrustedContact.id)
        )
        active = family_approval.active(policy, utcnow())
        return {
            "threshold_kzt": str(family_approval.MIN_AMOUNT),
            "owner_channel_ready": (
                settings.telegram_mode != "test" or owner in settings.family_owner_chats
            ),
            "channel": (
                "jury"
                if getattr(app.state, "jury_contact_available", False)
                else "telegram"
                if settings.telegram_mode == "test"
                else "simulation"
            ),
            "contact_id": policy.contact_id if active and policy else None,
            "disable_at": policy.disable_at if active and policy else None,
            "contacts": [{"id": c.id, "alias": c.alias} for c in contacts if eligible(c, owner)],
        }

    @app.post(base + "/second-confirmation")
    async def set_approval(
        body: ApprovalChange, principal: IdentityDep, session: SessionDep
    ) -> dict[str, Any]:
        owner = client(principal)
        async with serialized_identity(session, owner):
            await serialize_sender(session, owner)
            policy = await session.get(FamilyApprovalPolicy, owner)
            now = utcnow()
            if body.action == "enable":
                if body.contact_id is None:
                    raise HTTPException(422, "contact_required")
                if (
                    policy
                    and family_approval.active(policy, now)
                    and body.contact_id != policy.contact_id
                ):
                    raise HTTPException(409, "approval_contact_already_selected")
                contact = await session.get(TrustedContact, body.contact_id, with_for_update=True)
                if not contact or not eligible(contact, owner):
                    raise HTTPException(409, "eligible_contact_required")
                if policy is None:
                    session.add(FamilyApprovalPolicy(owner_id=owner, contact_id=contact.id))
                else:
                    policy.contact_id = contact.id
                    policy.disable_at = None
            elif policy and policy.disable_at is None:
                policy.disable_at = now + GRACE
            await session.commit()
        return await second_confirmation(principal, session)

    @app.get(base + "/family")
    async def family(principal: IdentityDep, session: SessionDep) -> dict[str, Any]:
        policy = await session.get(FamilyShield, client(principal))
        on = enabled(policy, utcnow())
        return {"enabled": on, "disable_at": policy.disable_at if on and policy else None}

    @app.post(base + "/family")
    async def change(body: Change, principal: IdentityDep, session: SessionDep) -> dict[str, Any]:
        owner = client(principal)
        await session.scalar(select(Account.id).where(Account.id == owner).with_for_update())
        policy = await session.get(FamilyShield, owner)
        if body.action == "enable":
            if policy is None:
                session.add(FamilyShield(owner_id=owner))
            else:
                policy.disable_at = None
        elif policy and policy.disable_at is None:
            policy.disable_at = utcnow() + GRACE
        await session.commit()
        return await family(principal, session)

    @app.get(base + "/{txid}/check")
    async def check(txid: UUID, principal: IdentityDep, session: SessionDep) -> dict[str, Any]:
        return await snapshot(session, await owned(session, txid, client(principal)))

    @app.post(base + "/{txid}/end")
    async def end(
        txid: UUID, principal: IdentityDep, session: SessionDep, engine: EngineDep
    ) -> dict[str, Any]:
        tx = await owned(session, txid, client(principal))
        if await recorded_call(session, txid) is None:
            try:
                await TransferService(session, engine).record_post_call(
                    txid, PostCallRequest(action="ended")
                )
            except ConflictError as exc:
                raise HTTPException(409, str(exc)) from exc
        return await snapshot(session, tx)

    @app.post(base + "/{txid}/answer")
    async def answer(
        txid: UUID, body: Answer, principal: IdentityDep, session: SessionDep, engine: EngineDep
    ) -> dict[str, Any]:
        tx = await owned(session, txid, client(principal))
        row = await recorded_call(session, tx.id)
        now = utcnow()
        if row is None:
            raise HTTPException(409, "call_end_required")
        if body.answer == "my_choice" and row.answer is None and now < row.ended_at + QUIET:
            raise HTTPException(409, "quiet_period")
        if row.answer is not None and row.answer != body.answer:
            raise HTTPException(409, "answer_already_recorded")
        service = TransferService(session, engine)
        try:
            # Legacy mobile checks may predate the shared call-ended event.
            await service.record_post_call(txid, PostCallRequest(action="ended"))
            if body.answer == "pressure":
                await service.cancel(txid, post_call_scam=True)
            else:
                await service.record_post_call(txid, PostCallRequest(action="recognized"))
        except ConflictError as exc:
            raise HTTPException(409, str(exc)) from exc
        return await snapshot(session, tx)

    @app.post(base + "/{txid}/notify")
    async def notify(txid: UUID, principal: IdentityDep, session: SessionDep) -> dict[str, Any]:
        owner = client(principal)
        await session.scalar(select(Account.id).where(Account.id == owner).with_for_update())
        tx = await owned(session, txid, owner, lock=True)
        if not enabled(await session.get(FamilyShield, owner), utcnow()):
            raise HTTPException(409, "family_disabled")
        if not settings.enabled or settings.telegram_mode == "disabled":
            raise HTTPException(503, "contact_channel_unavailable")
        already_requested = await session.scalar(
            select(
                exists().where(
                    ContactNotification.transaction_id == tx.id,
                    ContactNotification.owner_id == owner,
                )
            )
        )
        if not already_requested:
            contact = await session.scalar(
                select(TrustedContact)
                .where(
                    TrustedContact.owner_id == owner,
                    TrustedContact.state == "CONTACT_VERIFIED",
                    TrustedContact.contact_consented_at.is_not(None),
                    TrustedContact.notifications_enabled.is_(True),
                )
                .order_by(TrustedContact.created_at, TrustedContact.id)
                .limit(1)
            )
            if contact is None:
                raise HTTPException(409, "no_consented_contact")
            try:
                await TrustedContactService(session, settings).enqueue(owner, tx.id, contact.id)
            except IntegrationError as exc:
                raise HTTPException(exc.status, exc.code) from exc
        return await snapshot(session, tx)

    @app.get(base + "/{txid}/packet")
    async def packet(txid: UUID, principal: IdentityDep, session: SessionDep) -> dict[str, Any]:
        tx = await owned(session, txid, client(principal))
        row = await recorded_call(session, txid)
        notice = await receipt(session, tx)
        items: list[tuple[datetime, str]] = [(tx.created_at, "evaluated")]
        if tx.active_call:
            items.append((tx.created_at, "call_marked"))
        if tx.cooling_until:
            items.append((tx.created_at, "pause_started"))
        if tx.resolved_at:
            items.append((tx.resolved_at, "resolved"))
        if row:
            items.append((row.ended_at, "call_ended"))
            if row.answered_at and row.answer:
                items.append((row.answered_at, row.answer))
        if notice:
            items.append((notice.first_queued_at, "contact_queued"))
            approved_at = await session.scalar(
                select(FamilyApproval.approved_at).where(FamilyApproval.transaction_id == tx.id)
            )
            if approved_at:
                items.append((approved_at, "family_approved"))
        reports = (await session.execute(
            select(GuardianReport.id, GuardianReport.created_at, GuardianReport.state)
            .where(
                GuardianReport.owner_id == tx.sender_id,
                GuardianReport.transaction_id == tx.id,
                GuardianReport.contact_id.is_(None),
                GuardianReport.expires_at > utcnow(),
            )
            .order_by(GuardianReport.created_at, GuardianReport.id)
            .limit(100)
        )).all()
        items.extend((at, "report_created") for _, at, _ in reports)
        from app.mobile_gateway.security_inbox import case_messages

        visible = case_messages(tx.sender_id, utcnow()).subquery()
        messages = (await session.execute(
            select(visible.c.state, visible.c.time)
            .where(visible.c.object_id.in_([rid for rid, _, _ in reports]))
            .order_by(visible.c.time)
        )).all()
        recipient = await session.get(Account, tx.recipient_id)
        return {
            "transaction_id": tx.id,
            "created_at": tx.created_at,
            "amount": str(tx.amount),
            "status": tx.status,
            "currency": tx.currency,
            "contact_state": notice.state if notice else None,
            "generated_at": utcnow(),
            "recipient_reference": recipient.iban[-4:] if recipient else None,
            "soc_messages": [{"kind": kind, "at": at} for kind, at in messages],
            "reports": [{"id": rid, "state": state} for rid, _, state in reports],
            "events": [{"at": at, "kind": kind} for at, kind in sorted(items, key=lambda e: e[0])],
        }

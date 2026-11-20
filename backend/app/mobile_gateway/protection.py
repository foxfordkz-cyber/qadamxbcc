"""Read existing decisions and contact receipts; safety answers never settle a transfer."""

from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import SessionDep
from app.db.base import utcnow
from app.integrations.config import IntegrationSettings
from app.integrations.errors import IntegrationError
from app.integrations.models import ContactNotification, GuardianReport, TrustedContact
from app.integrations.telegram.service import TrustedContactService
from app.mobile_gateway.app import Identity, IdentityDep
from app.mobile_gateway.protection_models import FamilyShield, PostCall
from app.models import Account, Transaction, TransactionStatus

QUIET = timedelta(minutes=5)
GRACE = timedelta(hours=24)


class Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: Literal["my_choice", "pressure"]


class Change(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["enable", "disable"]


def client(principal: Identity) -> UUID:
    if principal.role != "client":
        raise HTTPException(403, "client_required")
    return principal.subject


async def owned(db: AsyncSession, txid: UUID, owner: UUID) -> Transaction:
    tx = await db.scalar(
        select(Transaction)
        .where(Transaction.id == txid, Transaction.sender_id == owner)
        .with_for_update()
    )
    if tx is None:
        raise HTTPException(404, "transaction_not_found")
    return tx


def enabled(policy: FamilyShield | None, now: datetime) -> bool:
    return bool(policy and (not policy.disable_at or policy.disable_at > now))


def call_state(tx: Transaction, row: PostCall | None, now: datetime) -> str:
    if row is None:
        return (
            "on_call" if tx.active_call and tx.status == TransactionStatus.COOLING_OFF else "none"
        )
    if row.answered_at:
        return "answered"
    return "ready" if row.ended_at + QUIET <= now else "waiting"


async def receipt(db: AsyncSession, tx: Transaction) -> ContactNotification | None:
    return await db.scalar(
        select(ContactNotification)
        .where(
            ContactNotification.transaction_id == tx.id,
            ContactNotification.owner_id == tx.sender_id,
        )
        .order_by(ContactNotification.created_at, ContactNotification.id)
        .limit(1)
    )


async def snapshot(db: AsyncSession, tx: Transaction) -> dict[str, Any]:
    now = utcnow()
    row = await db.get(PostCall, tx.id)
    notice = await receipt(db, tx)
    policy = await db.get(FamilyShield, tx.sender_id)
    return {
        "transaction_id": tx.id,
        "state": call_state(tx, row, now),
        "server_time": now,
        "ready_at": row.ended_at + QUIET if row else None,
        "answer": row.answer if row else None,
        "contact_state": notice.state if notice else None,
        "family_enabled": enabled(policy, now),
    }


def install_protection(app: FastAPI, settings: IntegrationSettings) -> None:
    base = "/mobile/v1/protection"

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
    async def end(txid: UUID, principal: IdentityDep, session: SessionDep) -> dict[str, Any]:
        tx = await owned(session, txid, client(principal))
        if await session.get(PostCall, txid) is None:
            if call_state(tx, None, utcnow()) != "on_call":
                raise HTTPException(409, "call_not_active")
            session.add(PostCall(transaction_id=tx.id, ended_at=utcnow()))
            await session.commit()
        return await snapshot(session, tx)

    @app.post(base + "/{txid}/answer")
    async def answer(
        txid: UUID, body: Answer, principal: IdentityDep, session: SessionDep
    ) -> dict[str, Any]:
        tx = await owned(session, txid, client(principal))
        row = await session.get(PostCall, tx.id)
        now = utcnow()
        if row is None or now < row.ended_at + QUIET:
            raise HTTPException(409, "quiet_period")
        if row.answer is not None and row.answer != body.answer:
            raise HTTPException(409, "answer_already_recorded")
        if row.answer is None:
            row.answer, row.answered_at = body.answer, now
            await session.commit()
        return await snapshot(session, tx)

    @app.post(base + "/{txid}/notify")
    async def notify(txid: UUID, principal: IdentityDep, session: SessionDep) -> dict[str, Any]:
        owner = client(principal)
        await session.scalar(select(Account.id).where(Account.id == owner).with_for_update())
        tx = await owned(session, txid, owner)
        if not enabled(await session.get(FamilyShield, owner), utcnow()):
            raise HTTPException(409, "family_disabled")
        if not settings.enabled or settings.telegram_mode == "disabled":
            raise HTTPException(503, "contact_channel_unavailable")
        if not await receipt(session, tx):
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
        row = await session.get(PostCall, txid)
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
            items.append((notice.created_at, "contact_queued"))
        reports = await session.scalars(
            select(GuardianReport.created_at)
            .where(GuardianReport.owner_id == tx.sender_id, GuardianReport.transaction_id == tx.id)
            .order_by(GuardianReport.created_at)
            .limit(100)
        )
        items.extend((time, "report_created") for time in reports)
        return {
            "transaction_id": tx.id,
            "created_at": tx.created_at,
            "amount": str(tx.amount),
            "status": tx.status,
            "currency": tx.currency,
            "contact_state": notice.state if notice else None,
            "events": [{"at": at, "kind": kind} for at, kind in sorted(items, key=lambda e: e[0])],
        }

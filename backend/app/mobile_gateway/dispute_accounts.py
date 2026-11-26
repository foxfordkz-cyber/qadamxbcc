"""Immutable statements of the two participants, independent of the risk decision."""

from datetime import datetime
from typing import Literal
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import SessionDep
from app.db.locks import serialized_identity
from app.integrations.models import IntegrationAudit
from app.mobile_gateway.app import Identity, IdentityDep
from app.models import PaymentReturn, Transaction

Answer = Literal["agreed", "unexpected", "redirect_requested"]
Side = Literal["sender", "recipient"]


class AccountAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: Answer


class AccountReply(AccountAnswer):
    at: datetime
    source: Literal["account", "jury_invite"] = "account"


class AccountViews(BaseModel):
    audience: Literal["sender", "recipient", "soc"]
    sender: AccountReply | None = None
    recipient: AccountReply | None = None


def statement_id(transfer: UUID, side: Side) -> UUID:
    return uuid5(NAMESPACE_URL, f"saqbol:dispute-statement:v1:{transfer}:{side}")


async def views(
    db: AsyncSession,
    transfer: UUID,
    principal: Identity,
    submit: AccountAnswer | None = None,
    *,
    jury_invite: bool = False,
) -> AccountViews:
    if principal.role == "platform_admin" or (principal.role != "client" and submit):
        raise HTTPException(403, "role_forbidden")
    async with serialized_identity(db, transfer):
        row = (
            await db.execute(
                select(Transaction.sender_id, Transaction.recipient_id, PaymentReturn.decision)
                .join(PaymentReturn, PaymentReturn.original_id == Transaction.id)
                .where(Transaction.id == transfer, PaymentReturn.reported_at.is_not(None))
            )
        ).one_or_none()
        if row is None:
            raise HTTPException(404, "open_dispute_required")
        side: Side | None = None
        if principal.role == "client":
            if principal.subject == row.sender_id:
                side = "sender"
            elif principal.subject == row.recipient_id:
                side = "recipient"
            else:
                raise HTTPException(404, "open_dispute_required")
        if side and submit:
            record_id = statement_id(transfer, side)
            existing = await db.get(IntegrationAudit, record_id)
            if existing and existing.event.removeprefix("jury_") != submit.answer:
                raise HTTPException(409, "statement_already_given")
            if not existing and row.decision is not None:
                raise HTTPException(409, "dispute_closed")
            if not existing:
                # A dedicated resource ID keeps participant replies out of ordinary
                # contact, report, transaction and receipt timelines.
                db.add(
                    IntegrationAudit(
                        id=record_id,
                        owner_id=principal.subject,
                        resource_id=record_id,
                        correlation_id=transfer,
                        event=("jury_" if jury_invite else "") + submit.answer,
                    )
                )
                await db.flush()
        result = AccountViews(audience=side or "soc")
        for role in ("sender", "recipient"):
            which: Side = "sender" if role == "sender" else "recipient"
            if side is not None and which != side:
                continue
            event = await db.get(IntegrationAudit, statement_id(transfer, which))
            if event:
                reply = AccountReply.model_validate(
                    {
                        "answer": event.event.removeprefix("jury_"),
                        "source": "jury_invite" if event.event.startswith("jury_") else "account",
                        "at": event.created_at,
                    }
                )
                if which == "sender":
                    result.sender = reply
                else:
                    result.recipient = reply
        if submit:
            await db.commit()
        return result


def install_dispute_accounts(app: FastAPI) -> None:
    path = "/mobile/v1/wallet/participant-statements/{transfer_id}"

    @app.get(path, response_model_exclude_none=True)
    async def read(transfer_id: UUID, principal: IdentityDep, db: SessionDep) -> AccountViews:
        return await views(db, transfer_id, principal)

    @app.post(path, response_model_exclude_none=True)
    async def answer(
        transfer_id: UUID, body: AccountAnswer, principal: IdentityDep, db: SessionDep
    ) -> AccountViews:
        return await views(db, transfer_id, principal, body)

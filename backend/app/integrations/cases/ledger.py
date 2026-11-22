"""Settled movements on the case payee's account before the linked transfer arrived."""

import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Transaction, TransactionStatus

DISPLAY_LIMIT = 8


class LedgerEntry(BaseModel):
    transaction_id: uuid.UUID
    direction: Literal["incoming", "outgoing"]
    amount: Decimal
    settled_at: datetime


class RecipientLedger(BaseModel):
    from_time: datetime
    before_time: datetime
    items: list[LedgerEntry]
    has_more: bool


async def recipient_ledger(
    session: AsyncSession, transaction_id: uuid.UUID, owner_id: uuid.UUID
) -> RecipientLedger | None:
    anchor = (
        await session.execute(
            select(Transaction.recipient_id, Transaction.created_at).where(
                Transaction.id == transaction_id,
                Transaction.sender_id == owner_id,
            )
        )
    ).one_or_none()
    if anchor is None:
        return None
    before = anchor.created_at
    since = before - timedelta(hours=24)
    recipient = anchor.recipient_id
    settled = func.coalesce(Transaction.resolved_at, Transaction.created_at)
    rows = (
        await session.execute(
            select(
                Transaction.id,
                Transaction.recipient_id,
                Transaction.amount,
                Transaction.resolved_at,
                Transaction.created_at,
            )
            .where(
                or_(Transaction.recipient_id == recipient, Transaction.sender_id == recipient),
                Transaction.sender_id != Transaction.recipient_id,
                Transaction.id != transaction_id,
                Transaction.currency == "KZT",
                Transaction.status == TransactionStatus.APPROVED,
                Transaction.created_at < before,
                settled >= since,
                settled < before,
            )
            .order_by(settled.desc(), Transaction.id.desc())
            .limit(DISPLAY_LIMIT + 1)
        )
    ).all()
    return RecipientLedger(
        from_time=since,
        before_time=before,
        items=[
            LedgerEntry(
                transaction_id=row.id,
                direction="incoming" if row.recipient_id == recipient else "outgoing",
                amount=row.amount,
                settled_at=row.resolved_at or row.created_at,
            )
            for row in rows[:DISPLAY_LIMIT]
        ],
        has_more=len(rows) > DISPLAY_LIMIT,
    )

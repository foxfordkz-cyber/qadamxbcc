"""Settled KZT receipts on one directed edge as known before a selected payment."""

from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Transaction, TransactionStatus

LIMIT = 12


class EdgeReceipt(BaseModel):
    transaction_id: UUID
    amount: Decimal
    settled_at: datetime


class EdgeReceipts(BaseModel):
    transaction_id: UUID
    source: UUID
    target: UUID
    from_time: datetime
    before_time: datetime
    items: list[EdgeReceipt]
    has_more: bool


async def edge_receipts(
    db: AsyncSession, transaction_id: UUID, source: UUID, target: UUID
) -> EdgeReceipts | None:
    anchor = await db.get(Transaction, transaction_id)
    if anchor is None or source == target or anchor.recipient_id not in (source, target):
        return None
    settled_at = func.coalesce(Transaction.resolved_at, Transaction.created_at)
    end = anchor.created_at
    start = end - timedelta(days=1)
    rows = (
        await db.execute(
            select(Transaction.id, Transaction.amount, settled_at.label("settled_at"))
            .where(
                Transaction.sender_id == source,
                Transaction.recipient_id == target,
                Transaction.id != transaction_id,
                Transaction.status == TransactionStatus.APPROVED,
                Transaction.currency == "KZT",
                Transaction.created_at < end,
                settled_at >= start,
                settled_at < end,
            )
            .order_by(settled_at.desc(), Transaction.id.desc())
            .limit(LIMIT + 1)
        )
    ).all()
    return EdgeReceipts(
        transaction_id=transaction_id,
        source=source,
        target=target,
        from_time=start,
        before_time=end,
        items=[
            EdgeReceipt(transaction_id=r.id, amount=r.amount, settled_at=r.settled_at)
            for r in rows[:LIMIT]
        ],
        has_more=len(rows) > LIMIT,
    )

"""Find settled transfers an officer can open from the recipient's graph."""

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.models import Transaction, TransactionStatus

SEARCH_LIMIT = 64
DISPLAY_LIMIT = 8


class TraceAnchor(BaseModel):
    transaction_id: uuid.UUID
    amount: Decimal
    settled_at: datetime


class TraceAnchors(BaseModel):
    account_id: uuid.UUID
    items: list[TraceAnchor]


async def recent_anchors(session: AsyncSession, account_id: uuid.UUID) -> TraceAnchors:
    now = utcnow()
    rows = await session.execute(
        select(
            Transaction.id,
            Transaction.amount,
            Transaction.created_at,
            Transaction.resolved_at,
            Transaction.status,
            Transaction.currency,
            Transaction.sender_id,
        )
        .where(Transaction.recipient_id == account_id)
        .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        .limit(SEARCH_LIMIT)
    )
    items = [
        TraceAnchor(
            transaction_id=row.id, amount=row.amount, settled_at=row.resolved_at or row.created_at
        )
        for row in rows
        if row.status == TransactionStatus.APPROVED
        and row.currency == "KZT"
        and row.sender_id != account_id
        and (row.resolved_at or row.created_at) <= now
    ]
    items.sort(key=lambda item: (item.settled_at, item.transaction_id), reverse=True)
    return TraceAnchors(account_id=account_id, items=items[:DISPLAY_LIMIT])

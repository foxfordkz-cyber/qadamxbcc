"""Settled payments to a recipient in the period before a reviewed SOC flag."""

import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Account, Transaction, TransactionStatus
from app.services.recipient_flags import FlagError, state

PAGE_SIZE = 20


class PriorReceipt(BaseModel):
    transaction_id: uuid.UUID
    sender_ref: str
    amount: Decimal
    status: Literal["approved"] = "approved"
    settled_at: datetime


class PriorReceipts(BaseModel):
    account_id: uuid.UUID
    flag_version: int
    from_time: datetime
    flagged_at: datetime
    items: list[PriorReceipt]
    next_cursor: uuid.UUID | None


async def prior_receipts(
    session: AsyncSession,
    account_id: uuid.UUID,
    version: int,
    days: int,
    cursor: uuid.UUID | None,
) -> PriorReceipts:
    flag = await state(session, account_id)
    if not flag.flagged or flag.version != version or flag.updated_at is None:
        raise FlagError(409, "reviewed_flag_required")
    since = flag.updated_at - timedelta(days=days)
    # Use the recipient/created_at index. Both initiation and settlement must
    # precede the reviewed flag; a later release must never look like a prior loss.
    query = (
        select(
            Transaction.id,
            Transaction.sender_id,
            Transaction.amount,
            Transaction.created_at,
            Transaction.resolved_at,
        )
        .join(Account, Transaction.recipient_id == Account.id)
        .where(
            Account.id == account_id,
            Account.is_flagged.is_(True),
            Account.flag_version == version,
            Transaction.sender_id != account_id,
            Transaction.status == TransactionStatus.APPROVED,
            Transaction.currency == "KZT",
            Transaction.created_at.between(since, flag.updated_at),
            or_(Transaction.resolved_at.is_(None), Transaction.resolved_at <= flag.updated_at),
        )
    )
    if cursor:
        anchor = (await session.execute(query.where(Transaction.id == cursor))).one_or_none()
        if anchor is None:
            raise FlagError(422, "invalid_receipt_cursor")
        query = query.where(
            tuple_(Transaction.created_at, Transaction.id) < (anchor.created_at, anchor.id)
        )
    rows = (
        await session.execute(
            query.order_by(Transaction.created_at.desc(), Transaction.id.desc()).limit(
                PAGE_SIZE + 1
            )
        )
    ).all()
    return PriorReceipts(
        account_id=account_id,
        flag_version=version,
        from_time=since,
        flagged_at=flag.updated_at,
        items=[
            PriorReceipt(
                transaction_id=row.id,
                sender_ref=row.sender_id.hex[-8:],
                amount=row.amount,
                settled_at=row.resolved_at or row.created_at,
            )
            for row in rows[:PAGE_SIZE]
        ],
        next_cursor=rows[PAGE_SIZE - 1].id if len(rows) > PAGE_SIZE else None,
    )

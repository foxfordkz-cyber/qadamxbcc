"""Spendable virtual KZT. The synthetic wallet starts with a fixed opening balance."""

from decimal import Decimal
from uuid import UUID

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.models import PaymentReturn, Transaction, TransactionStatus

OPENING = Decimal("5000000.00")


async def posted_balance(db: AsyncSession, owner: UUID) -> Decimal:
    tx = Transaction
    delta = await db.scalar(
        select(func.sum(case((tx.recipient_id == owner, tx.amount), else_=-tx.amount))).where(
            or_(tx.sender_id == owner, tx.recipient_id == owner),
            tx.sender_id != tx.recipient_id,
            tx.currency == "KZT",
            tx.status == TransactionStatus.APPROVED,
            func.coalesce(tx.resolved_at, tx.created_at) <= utcnow(),
        )
    )
    return OPENING + (delta or Decimal(0))


async def disputed_total(db: AsyncSession, owner: UUID) -> Decimal:
    # Read the original posting once per open dispute. A second report or appeal shares its PK.
    total = await db.scalar(
        select(func.sum(Transaction.amount))
        .select_from(PaymentReturn)
        .join(Transaction, Transaction.id == PaymentReturn.original_id)
        .where(
            Transaction.recipient_id == owner,
            Transaction.currency == "KZT",
            Transaction.status == TransactionStatus.APPROVED,
            PaymentReturn.reported_at.is_not(None),
            PaymentReturn.refund_transaction_id.is_(None),
            or_(PaymentReturn.decision.is_(None), PaymentReturn.decision == "uphold"),
        )
    )
    return total or Decimal("0.00")

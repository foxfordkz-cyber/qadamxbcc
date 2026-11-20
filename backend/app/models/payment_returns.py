import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PaymentReturn(Base):
    """An incoming payment has at most one return, including held or blocked attempts."""

    __tablename__ = "payment_returns"
    __table_args__ = (
        CheckConstraint("refund_transaction_id <> original_id", name="distinct_transactions"),
        CheckConstraint("decision IN ('clear', 'uphold')", name="review_decision"),
    )

    original_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), primary_key=True
    )
    refund_transaction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="RESTRICT"), unique=True
    )
    reported_at: Mapped[datetime | None] = mapped_column()
    appealed_at: Mapped[datetime | None] = mapped_column()
    reviewed_at: Mapped[datetime | None] = mapped_column()
    decision: Mapped[str | None] = mapped_column(String(8))

"""Core persistence model for BCC Shield.

Types are chosen to be portable: PostgreSQL in production, SQLite for tests.
"""

import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, utcnow

MONEY = Numeric(18, 2)


class TransactionStatus(enum.StrEnum):
    APPROVED = "approved"
    COOLING_OFF = "cooling_off"
    BLOCKED = "blocked"


class EdgeType(enum.StrEnum):
    TRANSFER = "transfer"
    SHARED_DEVICE = "shared_device"


def _enum_values(e: type[enum.StrEnum]) -> list[str]:
    return [m.value for m in e]


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    iin: Mapped[str] = mapped_column(String(12), unique=True)
    iban: Mapped[str] = mapped_column(String(20), unique=True)
    phone: Mapped[str] = mapped_column(String(16), unique=True)
    full_name: Mapped[str] = mapped_column(String(128))
    device_id: Mapped[str] = mapped_column(String(64), index=True)
    avg_tx_amount: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))
    is_flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    __table_args__ = (
        CheckConstraint("length(iin) = 12", name="iin_len"),
        CheckConstraint("iban LIKE 'KZ%'", name="iban_kz"),
    )


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"))
    recipient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"))
    amount: Mapped[Decimal] = mapped_column(MONEY)
    currency: Mapped[str] = mapped_column(String(3), default="KZT")
    status: Mapped[TransactionStatus] = mapped_column(
        Enum(
            TransactionStatus,
            name="transaction_status",
            values_callable=_enum_values,
            validate_strings=True,
        )
    )
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    device_id: Mapped[str] = mapped_column(String(64))
    active_call: Mapped[bool] = mapped_column(Boolean, default=False)
    from_deposit: Mapped[bool] = mapped_column(Boolean, default=False)
    is_new_device: Mapped[bool] = mapped_column(Boolean, default=False)
    is_new_recipient: Mapped[bool] = mapped_column(Boolean, default=False)
    cooling_until: Mapped[datetime | None] = mapped_column()
    resolved_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    sender: Mapped[Account] = relationship(foreign_keys=[sender_id], lazy="raise")
    recipient: Mapped[Account] = relationship(foreign_keys=[recipient_id], lazy="raise")
    risk_events: Mapped[list["RiskEvent"]] = relationship(
        back_populates="transaction",
        cascade="all, delete-orphan",
        order_by="RiskEvent.score_delta.desc()",
        lazy="raise",
    )

    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("risk_score BETWEEN 0 AND 100", name="risk_score_range"),
        Index("ix_transactions_created_at", "created_at"),
        Index("ix_transactions_sender_created", "sender_id", "created_at"),
        Index("ix_transactions_recipient_created", "recipient_id", "created_at"),
    )


class RiskEvent(Base):
    __tablename__ = "risk_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    transaction_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), index=True
    )
    layer: Mapped[str] = mapped_column(String(16))
    rule_code: Mapped[str] = mapped_column(String(64), index=True)
    score_delta: Mapped[int] = mapped_column(Integer)
    reason_kk: Mapped[str] = mapped_column(String(512))
    reason_ru: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    transaction: Mapped[Transaction] = relationship(back_populates="risk_events", lazy="raise")


class GraphEdge(Base):
    __tablename__ = "graph_edges"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    target_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    edge_type: Mapped[EdgeType] = mapped_column(
        Enum(EdgeType, name="edge_type", values_callable=_enum_values, validate_strings=True)
    )
    weight: Mapped[float] = mapped_column(Float, default=0.0)
    tx_count: Mapped[int] = mapped_column(Integer, default=0)
    last_seen_at: Mapped[datetime] = mapped_column(default=utcnow)

    __table_args__ = (
        UniqueConstraint("source_id", "target_id", "edge_type", name="uq_graph_edges_triplet"),
        Index("ix_graph_edges_target", "target_id"),
    )

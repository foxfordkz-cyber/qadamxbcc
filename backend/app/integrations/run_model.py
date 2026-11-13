import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class IntegrationRun(Base):
    __tablename__ = "integration_runs"
    __table_args__ = (
        UniqueConstraint("owner_id", "idempotency_key", name="uq_integration_run_key"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    transaction_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transactions.id"), unique=True)
    idempotency_key: Mapped[uuid.UUID] = mapped_column()
    correlation_id: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4)
    contact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("trusted_contacts.id"))
    gateway_identifier: Mapped[str | None] = mapped_column(String(44))
    state: Mapped[str] = mapped_column(String(16), default="QUEUED", index=True)
    contact_outcome: Mapped[str] = mapped_column(String(40), default="NOT_REQUESTED")
    notification_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("contact_notifications.id")
    )
    external_check_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("external_checks.id"))
    attempts: Mapped[int] = mapped_column(default=0)
    error_code: Mapped[str | None] = mapped_column(String(40))
    claimed_at: Mapped[datetime | None] = mapped_column()
    next_attempt_at: Mapped[datetime] = mapped_column(default=utcnow)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

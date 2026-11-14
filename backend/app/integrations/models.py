import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, String, UniqueConstraint, true
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class IntegrationAudit(Base):
    __tablename__ = "integration_audit"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(index=True)
    resource_id: Mapped[uuid.UUID] = mapped_column(index=True)
    correlation_id: Mapped[uuid.UUID] = mapped_column(index=True)
    event: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class TrustedContact(Base):
    __tablename__ = "trusted_contacts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), index=True)
    invitation_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    invitation_expires_at: Mapped[datetime] = mapped_column()
    language: Mapped[str] = mapped_column(String(2))
    alias: Mapped[str] = mapped_column(String(40), default="", server_default="")
    notifications_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=true()
    )
    state: Mapped[str] = mapped_column(String(40), default="CONTACT_PENDING_CONSENT")
    owner_consented_at: Mapped[datetime] = mapped_column(default=utcnow)
    contact_consented_at: Mapped[datetime | None] = mapped_column()
    # Internal delivery address only: never exposed in API responses, audit or logs.
    telegram_chat_id: Mapped[str | None] = mapped_column(String(24))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class ContactNotification(Base):
    __tablename__ = "contact_notifications"
    __table_args__ = (
        UniqueConstraint("contact_id", "transaction_id", name="uq_contact_transaction"),
        Index("ix_notification_due", "state", "next_attempt_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), index=True)
    contact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("trusted_contacts.id"))
    transaction_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transactions.id"), index=True)
    correlation_id: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4)
    state: Mapped[str] = mapped_column(String(40), default="NOTIFICATION_QUEUED")
    expires_at: Mapped[datetime] = mapped_column()
    claimed_at: Mapped[datetime | None] = mapped_column()
    attempts: Mapped[int] = mapped_column(default=0, server_default="0")
    next_attempt_at: Mapped[datetime | None] = mapped_column()
    message_id: Mapped[str | None] = mapped_column(String(32))
    error_code: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

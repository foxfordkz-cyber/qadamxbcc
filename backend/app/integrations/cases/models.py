import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class FraudCase(Base):
    __tablename__ = "guardian_cases"
    __table_args__ = (Index("ix_case_created_id", "created_at", "id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # A validated source reference, deliberately not a FK: report retention remains independent.
    report_id: Mapped[uuid.UUID] = mapped_column(unique=True)
    source: Mapped[str] = mapped_column(String(24))
    category: Mapped[str] = mapped_column(String(24))
    state: Mapped[str] = mapped_column(String(24), default="NEW")
    assignee: Mapped[str | None] = mapped_column(String(24))
    version: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    status_since: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(index=True)


class CaseEvent(Base):
    __tablename__ = "guardian_case_events"
    __table_args__ = (
        UniqueConstraint("case_id", "version", name="uq_case_event_version"),
        UniqueConstraint("case_id", "key", name="uq_case_event_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("guardian_cases.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column()
    key: Mapped[uuid.UUID] = mapped_column()
    actor_id: Mapped[uuid.UUID] = mapped_column()
    actor_role: Mapped[str] = mapped_column(String(16))
    request_hash: Mapped[str] = mapped_column(String(64))
    code: Mapped[str] = mapped_column(String(32))
    state: Mapped[str] = mapped_column(String(24))
    # Metadata only. Free text is separately retained and never copied to the audit/replay.
    result: Mapped[dict[str, Any]] = mapped_column(JSON)
    question: Mapped[str | None] = mapped_column(String(32))
    reply_to: Mapped[uuid.UUID | None] = mapped_column(unique=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class CaseContent(Base):
    __tablename__ = "guardian_case_content"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("guardian_case_events.id", ondelete="CASCADE"), primary_key=True
    )
    body: Mapped[str] = mapped_column(String(500))
    expires_at: Mapped[datetime] = mapped_column(index=True)

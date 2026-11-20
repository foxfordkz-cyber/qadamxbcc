"""Append-only decisions about access to the synthetic staff wallet."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow


class StaffAccessEvent(Base):
    __tablename__ = "mobile_staff_access_event"
    __table_args__ = (CheckConstraint("version > 0", name="positive_version"),)

    subject: Mapped[UUID] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(primary_key=True)
    actor: Mapped[UUID]
    enabled: Mapped[bool]
    at: Mapped[datetime] = mapped_column(default=utcnow)


async def staff_status(session: AsyncSession, subject: UUID) -> tuple[bool, int]:
    event = await session.scalar(
        select(StaffAccessEvent)
        .where(StaffAccessEvent.subject == subject)
        .order_by(StaffAccessEvent.version.desc())
        .limit(1)
    )
    return (event.enabled, event.version) if event else (True, 0)

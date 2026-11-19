"""Read-only operator inspection of existing durable notification jobs."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.integrations.models import ContactNotification
from app.integrations.telegram.schemas import NotificationState

Disposition = Literal["queued", "delayed", "processing", "ambiguous", "retry_exhausted", "terminal"]


class JobOut(BaseModel):
    id: uuid.UUID
    correlation_id: uuid.UUID
    state: NotificationState
    disposition: Disposition
    attempts: int
    created_at: datetime
    expires_at: datetime
    next_attempt_at: datetime | None
    processing_age_seconds: float | None
    queue_age_seconds: float
    error_code: str | None
    retry_scheduled: bool
    manual_resend_supported: Literal[False] = False


class JobPage(BaseModel):
    as_of: datetime
    items: list[JobOut]
    next_after_id: uuid.UUID | None


class QueueSummary(BaseModel):
    as_of: datetime
    by_state: dict[str, int]
    processing: int
    oldest_processing_age_seconds: float | None
    oldest_queued_age_seconds: float | None
    retry_exhausted: int
    ambiguous_delivery: int


def inspect_job(row: ContactNotification, now: datetime) -> JobOut:
    disposition: Disposition = "terminal"
    if row.error_code in {"delivery_uncertain", "delivery_failed_or_uncertain"}:
        disposition = "ambiguous"
    elif row.error_code == "retry_exhausted":
        disposition = "retry_exhausted"
    elif row.state == "NOTIFICATION_QUEUED":
        if row.claimed_at:
            disposition = (
                "ambiguous" if (now - row.claimed_at).total_seconds() >= 30 else "processing"
            )
        elif row.next_attempt_at and row.next_attempt_at > now:
            disposition = "delayed"
        else:
            disposition = "queued"
    return JobOut(
        id=row.id,
        correlation_id=row.correlation_id,
        state=NotificationState(row.state),
        disposition=disposition,
        attempts=row.attempts,
        created_at=row.created_at,
        expires_at=row.expires_at,
        next_attempt_at=row.next_attempt_at,
        processing_age_seconds=max(0, (now - row.claimed_at).total_seconds())
        if row.claimed_at and row.state == "NOTIFICATION_QUEUED"
        else None,
        queue_age_seconds=max(0, (now - row.created_at).total_seconds()),
        error_code=row.error_code,
        retry_scheduled=(
            row.state == "NOTIFICATION_QUEUED"
            and row.claimed_at is None
            and row.next_attempt_at is not None
            and row.error_code == "telegram_rate_limited"
            and row.attempts < 3
            and row.expires_at > now
        ),
    )


async def jobs(
    session: AsyncSession,
    limit: int,
    after_id: uuid.UUID | None,
    failed_only: bool,
) -> JobPage:
    query = select(ContactNotification)
    if after_id:
        query = query.where(ContactNotification.id > after_id)
    if failed_only:
        query = query.where(ContactNotification.state == "DELIVERY_FAILED")
    rows = list(await session.scalars(query.order_by(ContactNotification.id).limit(limit + 1)))
    now = utcnow()
    return JobPage(
        as_of=now,
        items=[inspect_job(row, now) for row in rows[:limit]],
        next_after_id=rows[limit - 1].id if len(rows) > limit else None,
    )


async def queue_summary(session: AsyncSession) -> QueueSummary:
    now = utcnow()
    by_state = {
        state: int(count)
        for state, count in (
            await session.execute(
                select(ContactNotification.state, func.count()).group_by(ContactNotification.state)
            )
        ).all()
    }
    processing, oldest = (
        await session.execute(
            select(func.count(), func.min(ContactNotification.claimed_at)).where(
                ContactNotification.state == "NOTIFICATION_QUEUED",
                ContactNotification.claimed_at.is_not(None),
            )
        )
    ).one()
    queued = await session.scalar(
        select(func.min(ContactNotification.created_at)).where(
            ContactNotification.state == "NOTIFICATION_QUEUED"
        )
    )
    errors = {
        code: int(count)
        for code, count in (
            await session.execute(
                select(ContactNotification.error_code, func.count())
                .where(ContactNotification.state == "DELIVERY_FAILED")
                .group_by(ContactNotification.error_code)
            )
        ).all()
    }
    return QueueSummary(
        as_of=now,
        by_state=by_state,
        processing=int(processing),
        oldest_processing_age_seconds=max(0, (now - oldest).total_seconds()) if oldest else None,
        oldest_queued_age_seconds=max(0, (now - queued).total_seconds()) if queued else None,
        retry_exhausted=errors.get("retry_exhausted", 0),
        ambiguous_delivery=errors.get("delivery_uncertain", 0)
        + errors.get("delivery_failed_or_uncertain", 0),
    )

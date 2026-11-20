"""Minimal role timeline. Never select private case text, chat IDs, or contact identities."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.integrations.cases.models import CaseEvent, FraudCase
from app.integrations.errors import IntegrationError
from app.integrations.models import ContactNotification, GuardianReport, IntegrationAudit
from app.integrations.telegram.schemas import NotificationState
from app.models import Transaction

LIMIT = 40
NOTIFICATION_EVENTS = {state.value for state in NotificationState} | {"NOTIFICATION_RETRY"}
CASE_ACTIONS = {"OPENED", "ASSIGN", "REQUEST_INFORMATION", "TRANSITION"}
CASE_STATES = {"NEW", "IN_REVIEW", "NEEDS_INFORMATION", "ESCALATED", "RESOLVED", "CLOSED"}


class StoryEvent(BaseModel):
    role: Literal["customer", "guardian", "soc"]
    code: str
    timestamp: datetime


class PrivateStory(BaseModel):
    transaction_id: uuid.UUID
    events: list[StoryEvent] = Field(max_length=LIMIT)
    truncated: bool


async def private_story(session: AsyncSession, transaction_id: uuid.UUID) -> PrivateStory:
    sender = await session.scalar(
        select(Transaction.sender_id).where(Transaction.id == transaction_id)
    )
    if sender is None:
        raise IntegrationError(404, "transaction_not_found")
    now = utcnow()
    notifications = await session.execute(
        select(IntegrationAudit.event, IntegrationAudit.created_at)
        .join(ContactNotification, ContactNotification.id == IntegrationAudit.resource_id)
        .where(
            ContactNotification.transaction_id == transaction_id,
            ContactNotification.owner_id == sender,
            IntegrationAudit.owner_id == sender,
            IntegrationAudit.event.in_(NOTIFICATION_EVENTS),
        )
        .order_by(IntegrationAudit.created_at.desc(), IntegrationAudit.id.desc())
        .limit(LIMIT + 1)
    )
    events = [
        StoryEvent(role="guardian", code=code, timestamp=at)
        for code, at in reversed(notifications.all())
    ]
    owner_reports = await session.scalars(
        select(GuardianReport.created_at)
        .where(
            GuardianReport.transaction_id == transaction_id,
            GuardianReport.owner_id == sender,
            GuardianReport.contact_id.is_(None),
            GuardianReport.expires_at > now,
        )
        .order_by(GuardianReport.created_at.desc(), GuardianReport.id.desc())
        .limit(LIMIT + 1)
    )
    events.extend(
        StoryEvent(role="customer", code="OWNER_REPORT_SUBMITTED", timestamp=at)
        for at in owner_reports
    )
    cases = await session.execute(
        select(CaseEvent.code, CaseEvent.state, CaseEvent.created_at)
        .join(FraudCase, FraudCase.id == CaseEvent.case_id)
        .join(GuardianReport, GuardianReport.id == FraudCase.report_id)
        .where(
            GuardianReport.transaction_id == transaction_id,
            GuardianReport.owner_id == sender,
            GuardianReport.expires_at > now,
            FraudCase.expires_at > now,
            CaseEvent.actor_role == "soc",
            CaseEvent.code.in_(CASE_ACTIONS),
            CaseEvent.state.in_(CASE_STATES),
        )
        .order_by(CaseEvent.created_at.desc(), CaseEvent.version.desc(), CaseEvent.id.desc())
        .limit(LIMIT + 1)
    )
    for action, state, at in reversed(cases.all()):
        code = f"CASE_{state}" if action == "TRANSITION" else f"CASE_{action}"
        events.append(StoryEvent(role="soc", code=code, timestamp=at))
    events.sort(key=lambda event: event.timestamp)
    return PrivateStory(
        transaction_id=transaction_id, events=events[-LIMIT:], truncated=len(events) > LIMIT
    )

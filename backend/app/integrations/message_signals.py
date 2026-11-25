"""Consented category-only evidence for one existing owner report."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.integrations.cases.models import FraudCase
from app.integrations.errors import IntegrationError
from app.integrations.models import GuardianReport, IntegrationAudit

SignalCode = Literal["bankClaim", "safeAccount", "secrecy", "codeRequest"]
EVENTS: dict[SignalCode, str] = {
    "bankClaim": "MESSAGE_SIGNAL_BANK_CLAIM",
    "safeAccount": "MESSAGE_SIGNAL_SAFE_ACCOUNT",
    "secrecy": "MESSAGE_SIGNAL_SECRECY",
    "codeRequest": "MESSAGE_SIGNAL_CODE_REQUEST",
}


class SignalInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: SignalCode
    consent: Literal[True]


class ReportOption(BaseModel):
    id: uuid.UUID
    created_at: datetime


class SignalReceipt(BaseModel):
    report_id: uuid.UUID
    category: SignalCode


async def options(session: AsyncSession, owner: uuid.UUID) -> list[ReportOption]:
    rows = await session.execute(
        select(GuardianReport.id, GuardianReport.created_at)
        .outerjoin(FraudCase, FraudCase.report_id == GuardianReport.id)
        .where(
            GuardianReport.owner_id == owner,
            GuardianReport.contact_id.is_(None),
            GuardianReport.description.is_not(None),
            GuardianReport.expires_at > utcnow(),
            (FraudCase.id.is_(None)) | (FraudCase.state.not_in(("RESOLVED", "CLOSED"))),
        )
        .order_by(GuardianReport.created_at.desc(), GuardianReport.id)
        .limit(50)
    )
    return [ReportOption(id=i, created_at=at) for i, at in rows]


async def attach(
    session: AsyncSession, owner: uuid.UUID, report_id: uuid.UUID, body: SignalInput
) -> SignalReceipt:
    report = await session.scalar(
        select(GuardianReport)
        .where(
            GuardianReport.id == report_id,
            GuardianReport.owner_id == owner,
            GuardianReport.contact_id.is_(None),
        )
        .with_for_update()
    )
    if not report:
        raise IntegrationError(404, "incident_not_found")
    if report.description is None or report.expires_at <= utcnow():
        raise IntegrationError(410, "incident_expired")
    case = await session.scalar(
        select(FraudCase).where(FraudCase.report_id == report_id).with_for_update()
    )
    if case and case.state in ("RESOLVED", "CLOSED"):
        raise IntegrationError(409, "case_closed")
    event = EVENTS[body.category]
    event_id = uuid.uuid5(report_id, event)
    if await session.get(IntegrationAudit, event_id) is None:
        session.add(
            IntegrationAudit(
                id=event_id,
                owner_id=owner,
                resource_id=report_id,
                correlation_id=report_id,
                event=event,
            )
        )
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            if await session.get(IntegrationAudit, event_id) is None:
                raise
    return SignalReceipt(report_id=report_id, category=body.category)


async def attached(session: AsyncSession, report: GuardianReport) -> list[SignalCode]:
    if report.description is None or report.expires_at <= utcnow():
        return []
    events = set(
        await session.scalars(
            select(IntegrationAudit.event).where(
                IntegrationAudit.owner_id == report.owner_id,
                IntegrationAudit.resource_id == report.id,
                IntegrationAudit.event.in_(EVENTS.values()),
            )
        )
    )
    return [code for code, event in EVENTS.items() if event in events]

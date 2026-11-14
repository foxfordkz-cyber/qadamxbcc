"""Deterministic fact projection for SOC; no second risk model."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import exists, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.integrations.errors import IntegrationError
from app.integrations.health_details import HealthDetails
from app.integrations.models import (
    ContactNotification,
    GuardianReport,
    IntegrationAudit,
    TrustedContact,
)
from app.integrations.nbk_mock.models import ExternalCheck
from app.integrations.nbk_mock.schemas import ExternalCheckOut
from app.integrations.nbk_mock.service import GatewayService
from app.integrations.run_model import IntegrationRun
from app.integrations.telegram.schemas import NotificationOut
from app.integrations.timeline import TimelineEvent, event
from app.models import Transaction, TransactionStatus


class ConsentFact(BaseModel):
    contact_id: uuid.UUID
    state: str
    consented: bool
    notifications_enabled: bool


class IncidentSummary(BaseModel):
    transaction_id: uuid.UUID
    core_status: TransactionStatus
    cooling_until: datetime | None
    cooling_active: bool
    consents: list[ConsentFact]
    notifications: list[NotificationOut]
    gateway_results: list[ExternalCheckOut]
    recent_events: list[TimelineEvent]
    manual_review_reasons: list[str]
    manual_review_requested: bool
    description_ru: str
    description_kk: str
    health: HealthDetails
    advisory_only: Literal[True] = True


async def summarize(
    session: AsyncSession, transaction_id: uuid.UUID, health: HealthDetails
) -> IncidentSummary:
    tx = await session.get(Transaction, transaction_id)
    if tx is None:
        raise IntegrationError(404, "transaction_not_found")
    notifications = list(
        await session.scalars(
            select(ContactNotification)
            .where(ContactNotification.transaction_id == tx.id)
            .order_by(ContactNotification.created_at.desc())
            .limit(100)
        )
    )
    checks = list(
        await session.scalars(
            select(ExternalCheck)
            .where(ExternalCheck.transaction_id == tx.id)
            .order_by(ExternalCheck.created_at.desc())
            .limit(10)
        )
    )
    run = await session.scalar(select(IntegrationRun).where(IntegrationRun.transaction_id == tx.id))
    contact_ids = [r.contact_id for r in notifications] + (
        [run.contact_id] if run and run.contact_id else []
    )
    contacts = list(
        await session.scalars(
            select(TrustedContact).where(
                TrustedContact.id.in_(contact_ids), TrustedContact.owner_id == tx.sender_id
            )
        )
    )
    resources = union_all(
        select(ContactNotification.id).where(ContactNotification.transaction_id == tx.id),
        select(ExternalCheck.id).where(ExternalCheck.transaction_id == tx.id),
        select(IntegrationRun.id).where(IntegrationRun.transaction_id == tx.id),
        select(GuardianReport.id).where(GuardianReport.transaction_id == tx.id),
    )
    audits = list(
        await session.scalars(
            select(IntegrationAudit)
            .where(
                IntegrationAudit.owner_id == tx.sender_id,
                IntegrationAudit.resource_id.in_(resources),
            )
            .order_by(IntegrationAudit.created_at.desc(), IntegrationAudit.id.desc())
            .limit(10)
        )
    )
    reasons = []
    if tx.status == TransactionStatus.BLOCKED:
        reasons.append("CORE_BLOCKED")
    if await session.scalar(
        select(
            exists().where(
                ContactNotification.transaction_id == tx.id,
                ContactNotification.state == "SUSPICION_REPORTED",
            )
        )
    ):
        reasons.append("CONTACT_SUSPICION")
    if await session.scalar(
        select(
            exists().where(
                ContactNotification.transaction_id == tx.id,
                ContactNotification.state == "DELIVERY_FAILED",
            )
        )
    ):
        reasons.append("DELIVERY_NOT_CONFIRMED")
    if run and run.state in {"FAILED", "DEGRADED"}:
        reasons.append("INTEGRATION_DEGRADED")
    # These are conservative display/triage labels, never bank workflow commands.
    return IncidentSummary(
        transaction_id=tx.id,
        core_status=tx.status,
        cooling_until=tx.cooling_until,
        cooling_active=tx.status == TransactionStatus.COOLING_OFF
        and tx.cooling_until is not None
        and tx.cooling_until > utcnow(),
        consents=[
            ConsentFact(
                contact_id=c.id,
                state=c.state,
                consented=c.state == "CONTACT_VERIFIED" and c.contact_consented_at is not None,
                notifications_enabled=c.notifications_enabled,
            )
            for c in contacts
        ],
        notifications=[NotificationOut.model_validate(n) for n in notifications],
        gateway_results=[GatewayService.output(c) for c in checks if c.result is not None],
        recent_events=[
            event(f"audit:{a.id.hex}", a.created_at, a.event, a.correlation_id)
            for a in reversed(audits)
        ],
        manual_review_reasons=reasons,
        manual_review_requested=bool(reasons),
        description_ru="Сводка сохранённых фактов. Сигналы требуют внимания оператора демо."
        if reasons
        else (
            "Сводка сохранённых фактов. Указанных сигналов для просмотра нет; "
            "это не гарантия безопасности."
        ),
        description_kk="Сақталған деректер жиынтығы. Белгілер демо оператордың назарын қажет етеді."
        if reasons
        else "Сақталған деректер жиынтығы. Көрсетілген белгілер жоқ; бұл қауіпсіздік кепілі емес.",
        health=health,
    )

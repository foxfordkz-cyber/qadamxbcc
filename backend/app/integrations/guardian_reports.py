"""Explicit demo incident submission; no bank actions or external forwarding."""

import hashlib
import json
import re
import unicodedata
import uuid
from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import String, cast, delete, func, literal, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.integrations.audit import record
from app.integrations.errors import IntegrationError
from app.integrations.models import GuardianReport, TrustedContact
from app.models import Account, Transaction

Category = Literal["impersonation", "safe_account", "remote_access", "other"]


class ReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Category
    description: str = Field(min_length=10, max_length=500)
    transaction_id: uuid.UUID | None = None
    confirmed_demo_submission: Literal[True]

    @field_validator("description")
    @classmethod
    def safe_description(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 10 or any(unicodedata.category(c).startswith("C") for c in value):
            raise ValueError("use a short plain-text description without controls")
        # Conservative minimization, not a guarantee that arbitrary text contains no PII.
        if re.search(
            r"\d{4,}|https?://|@|\b(?:pin|cvv|cvc|otp|password)\b|парол|құпиясөз",
            value,
            re.IGNORECASE,
        ):
            raise ValueError("omit secrets, identifiers, links and contact details")
        return value


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    source: Literal["owner_demo", "trusted_contact"]
    category: Category
    description: str
    transaction_id: uuid.UUID | None
    state: Literal["SUBMITTED", "DEMO_ACKNOWLEDGED"]
    created_at: datetime
    expires_at: datetime
    demonstration_only: Literal[True] = True


async def contact_identity(
    session: AsyncSession, contact_id: uuid.UUID, chat_id: int
) -> TrustedContact:
    contact = await session.scalar(
        select(TrustedContact)
        .where(
            TrustedContact.id == contact_id,
            TrustedContact.telegram_chat_id == str(chat_id),
            TrustedContact.state == "CONTACT_VERIFIED",
            TrustedContact.contact_consented_at.is_not(None),
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    if contact is None:
        raise IntegrationError(404, "verified_contact_required")
    return contact


async def create_report(
    session: AsyncSession,
    owner: uuid.UUID,
    body: ReportRequest,
    key: uuid.UUID,
    *,
    contact_id: uuid.UUID | None = None,
) -> GuardianReport:
    # Serialize quota with other owner writes; recipient identity is checked by the caller.
    account = await session.scalar(
        select(Account).where(Account.id == owner).with_for_update(key_share=True)
    )
    if account is None:
        raise IntegrationError(404, "owner_not_found")
    if body.transaction_id:
        tx = await session.get(Transaction, body.transaction_id)
        if tx is None or tx.sender_id != owner:
            raise IntegrationError(404, "transaction_not_found")
        if contact_id is not None:
            raise IntegrationError(403, "recipient_report_has_no_transaction_authority")
    digest = hashlib.sha256(
        json.dumps(
            {
                "body": body.model_dump(mode="json"),
                "contact": str(contact_id),
            },
            sort_keys=True,
            ensure_ascii=False,
        ).encode()
    ).hexdigest()
    prior = await session.scalar(
        select(GuardianReport).where(
            GuardianReport.owner_id == owner, GuardianReport.idempotency_key == key
        )
    )
    if prior:
        if prior.expires_at <= utcnow():
            raise IntegrationError(410, "incident_expired")
        if prior.content_hash != digest:
            raise IntegrationError(409, "incident_payload_conflict")
        return prior
    duplicate = await session.scalar(
        select(GuardianReport.id).where(
            GuardianReport.owner_id == owner, GuardianReport.content_hash == digest
        )
    )
    if duplicate:
        raise IntegrationError(409, "duplicate_incident")
    count = await session.scalar(
        select(func.count())
        .select_from(GuardianReport)
        .where(
            GuardianReport.owner_id == owner,
            GuardianReport.created_at > utcnow() - timedelta(days=1),
        )
    )
    if (count or 0) >= 5:
        raise IntegrationError(429, "incident_daily_limit")
    row = GuardianReport(
        id=uuid.uuid4(),
        owner_id=owner,
        contact_id=contact_id,
        transaction_id=body.transaction_id,
        idempotency_key=key,
        content_hash=digest,
        category=body.category,
        description=body.description,
        state="SUBMITTED",
        expires_at=utcnow() + timedelta(days=7),
    )
    session.add(row)
    record(session, owner, row.id, row.id, "GUARDIAN_REPORT_SUBMITTED")
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise IntegrationError(409, "duplicate_incident") from None
    return row


async def expire_reports(session: AsyncSession) -> int:
    ids = list(
        await session.scalars(
            select(GuardianReport.id)
            .where(GuardianReport.expires_at <= utcnow(), GuardianReport.description.is_not(None))
            .limit(100)
        )
    )
    if ids:
        await session.execute(
            update(GuardianReport)
            .where(GuardianReport.id.in_(ids))
            .values(
                description=None, content_hash=literal("expired:") + cast(GuardianReport.id, String)
            )
        )
        await session.commit()
    old = list(
        await session.scalars(
            select(GuardianReport.id)
            .where(GuardianReport.created_at <= utcnow() - timedelta(days=30))
            .limit(100)
        )
    )
    if old:
        await session.execute(delete(GuardianReport).where(GuardianReport.id.in_(old)))
        await session.commit()
    return len(ids)


def report_output(row: GuardianReport) -> ReportOut:
    if row.expires_at <= utcnow() or row.description is None:
        raise IntegrationError(410, "incident_expired")
    return ReportOut.model_validate(row)

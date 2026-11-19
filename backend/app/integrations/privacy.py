"""Owner-scoped permissions, using existing consent records without delivery addresses."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.integrations.errors import IntegrationError
from app.integrations.models import IntegrationAudit, TrustedContact
from app.integrations.telegram.schemas import ContactState


class PermissionOut(BaseModel):
    contact_id: uuid.UUID
    state: ContactState
    language: str
    notifications_enabled: bool
    owner_consented_at: datetime
    last_contact_consent_at: datetime | None
    consent_currently_valid: bool
    delivery_identifiers_erased: bool


class PermissionPage(BaseModel):
    exported_at: datetime
    permissions: list[PermissionOut]
    next_after_id: uuid.UUID | None
    active_contact_limit: Literal[3] = 3
    recipients_per_notification: Literal[1] = 1
    retention_policy: Literal[
        "personal_fields_until_revoke_metadata_until_demo_database_removal"
    ] = "personal_fields_until_revoke_metadata_until_demo_database_removal"


class PermissionEvent(BaseModel):
    id: uuid.UUID
    event: str
    created_at: datetime


class PermissionHistory(BaseModel):
    events: list[PermissionEvent]
    next_after_id: uuid.UUID | None


async def export_permissions(
    session: AsyncSession,
    owner: uuid.UUID,
    limit: int,
    after_id: uuid.UUID | None,
) -> PermissionPage:
    query = select(TrustedContact).where(TrustedContact.owner_id == owner)
    if after_id:
        query = query.where(TrustedContact.id > after_id)
    rows = list(await session.scalars(query.order_by(TrustedContact.id).limit(limit + 1)))
    return PermissionPage(
        exported_at=utcnow(),
        permissions=[
            PermissionOut(
                contact_id=row.id,
                state=ContactState(row.state),
                language=row.language,
                notifications_enabled=row.notifications_enabled,
                owner_consented_at=row.owner_consented_at,
                last_contact_consent_at=row.contact_consented_at,
                consent_currently_valid=row.state == "CONTACT_VERIFIED"
                and row.contact_consented_at is not None,
                delivery_identifiers_erased=row.telegram_chat_id is None
                and row.invitation_hash is None,
            )
            for row in rows[:limit]
        ],
        next_after_id=rows[limit - 1].id if len(rows) > limit else None,
    )


async def permission_history(
    session: AsyncSession,
    owner: uuid.UUID,
    contact_id: uuid.UUID,
    limit: int,
    after_id: uuid.UUID | None,
) -> PermissionHistory:
    row = await session.get(TrustedContact, contact_id)
    if row is None or row.owner_id != owner:
        raise IntegrationError(404, "contact_not_found")
    query = select(IntegrationAudit).where(
        IntegrationAudit.owner_id == owner,
        IntegrationAudit.resource_id == contact_id,
        IntegrationAudit.event.in_(
            [
                "CONTACT_PENDING_CONSENT",
                "CONTACT_BOUND_AWAITING_CONSENT",
                "CONTACT_VERIFIED",
                "CONTACT_REVOKED",
                "CONTACT_PREFERENCES_UPDATED",
            ]
        ),
    )
    if after_id:
        anchor = await session.scalar(query.where(IntegrationAudit.id == after_id))
        if anchor is None:
            raise IntegrationError(400, "permission_cursor_invalid")
        query = query.where(
            or_(
                IntegrationAudit.created_at > anchor.created_at,
                and_(
                    IntegrationAudit.created_at == anchor.created_at,
                    IntegrationAudit.id > anchor.id,
                ),
            )
        )
    events = list(
        await session.scalars(
            query.order_by(IntegrationAudit.created_at, IntegrationAudit.id).limit(limit + 1)
        )
    )
    return PermissionHistory(
        events=[
            PermissionEvent(id=e.id, event=e.event, created_at=e.created_at) for e in events[:limit]
        ],
        next_after_id=events[limit - 1].id if len(events) > limit else None,
    )

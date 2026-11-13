import uuid

from fastapi import APIRouter, Response
from sqlalchemy import select

from app.api.deps import SessionDep
from app.integrations.errors import IntegrationError
from app.integrations.models import ContactNotification, IntegrationAudit
from app.integrations.security import ConfigDep, PrincipalDep, require_role
from app.integrations.telegram.handlers import process_update
from app.integrations.telegram.schemas import (
    AuditOut,
    ContactOut,
    ContactsOut,
    InvitationOut,
    InviteRequest,
    NotificationOut,
    NotificationRequest,
    SimulatedUpdate,
    UpdateOut,
)
from app.integrations.telegram.service import TrustedContactService

router = APIRouter(prefix="/trusted-contacts", tags=["trusted contacts (advisory)"])


@router.post("", response_model=InvitationOut, status_code=201)
async def invite(
    body: InviteRequest,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    response: Response,
) -> InvitationOut:
    require_role(principal, "owner")
    response.headers["Cache-Control"] = "no-store"
    return await TrustedContactService(session, cfg).invite(principal.subject, body)


@router.get("", response_model=ContactsOut)
async def contacts(session: SessionDep, cfg: ConfigDep, principal: PrincipalDep) -> ContactsOut:
    require_role(principal, "owner")
    return await TrustedContactService(session, cfg).contacts(principal.subject)


@router.delete("/{contact_id}", response_model=ContactOut)
async def revoke(
    contact_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
) -> ContactOut:
    require_role(principal, "owner")
    row = await TrustedContactService(session, cfg).revoke(contact_id, owner=principal.subject)
    return ContactOut.model_validate(row)


@router.post("/transactions/{transaction_id}/notifications", response_model=NotificationOut)
async def enqueue(
    transaction_id: uuid.UUID,
    body: NotificationRequest,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
) -> NotificationOut:
    require_role(principal, "owner")
    row = await TrustedContactService(session, cfg).enqueue(
        principal.subject,
        transaction_id,
        body.contact_id,
    )
    return NotificationOut.model_validate(row)


@router.get("/transactions/{transaction_id}/notifications", response_model=list[NotificationOut])
async def notifications(
    transaction_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
) -> list[NotificationOut]:
    require_role(principal, "owner")
    rows = await session.scalars(
        select(ContactNotification)
        .where(
            ContactNotification.transaction_id == transaction_id,
            ContactNotification.owner_id == principal.subject,
        )
        .order_by(ContactNotification.created_at)
    )
    return [NotificationOut.model_validate(row) for row in rows]


@router.get("/notifications/{notification_id}/history", response_model=list[AuditOut])
async def history(
    notification_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
) -> list[AuditOut]:
    require_role(principal, "owner")
    rows = await session.scalars(
        select(IntegrationAudit)
        .where(
            IntegrationAudit.resource_id == notification_id,
            IntegrationAudit.owner_id == principal.subject,
        )
        .order_by(IntegrationAudit.created_at, IntegrationAudit.id)
    )
    return [AuditOut.model_validate(row) for row in rows]


@router.post("/simulator/update", response_model=UpdateOut)
async def simulate(
    body: SimulatedUpdate,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
) -> UpdateOut:
    require_role(principal, "simulator")
    if cfg.telegram_mode != "fake":
        raise IntegrationError(404, "simulator_disabled")
    return await process_update(TrustedContactService(session, cfg), body)

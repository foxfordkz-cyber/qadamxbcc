import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, SecretStr
from redis.exceptions import RedisError
from sqlalchemy import select

from app.api.deps import SessionDep
from app.api.security import require_transfer_access
from app.integrations.errors import IntegrationError
from app.integrations.models import ContactNotification, IntegrationAudit
from app.integrations.security import (
    CirclePrincipalDep,
    ConfigDep,
    PrincipalDep,
    ResourcesDep,
    require_role,
)
from app.integrations.telegram.handlers import process_update
from app.integrations.telegram.schemas import (
    AuditOut,
    ContactOut,
    ContactPreferences,
    ContactsOut,
    InvitationOut,
    InviteRequest,
    NotificationOut,
    NotificationRequest,
    SimulatedUpdate,
    UpdateOut,
)
from app.integrations.telegram.service import TrustedContactService
from app.integrations.telegram.web_session import SESSION_TTL, end_session, exchange

router = APIRouter(prefix="/trusted-contacts", tags=["trusted contacts (advisory)"])


class CircleLogin(BaseModel):
    code: SecretStr = Field(min_length=16, max_length=16)


class CircleSession(BaseModel):
    session: str
    expires_in: int


@router.get("/web-session", dependencies=[Depends(require_transfer_access)])
async def session_available(
    response: Response, cfg: ConfigDep, resources: ResourcesDep
) -> dict[str, bool]:
    if not cfg.circle_web_owners:
        raise HTTPException(503, "circle_web_unavailable")
    try:
        await resources.redis.ping()
    except RedisError as exc:
        raise HTTPException(503, "circle session store unavailable") from exc
    response.headers["Cache-Control"] = "no-store"
    return {"available": True}


@router.post("/web-session", dependencies=[Depends(require_transfer_access)])
async def login(
    body: CircleLogin, response: Response, cfg: ConfigDep, resources: ResourcesDep
) -> CircleSession:
    if not cfg.circle_web_owners:
        raise HTTPException(503, "circle_web_unavailable")
    try:
        token = await exchange(resources.redis, cfg, body.code.get_secret_value())
    except RedisError as exc:
        raise HTTPException(503, "circle session store unavailable") from exc
    if token is None:
        raise HTTPException(401, "invalid_or_expired_code")
    response.headers["Cache-Control"] = "no-store"
    return CircleSession(session=token, expires_in=SESSION_TTL)


@router.delete("/web-session", dependencies=[Depends(require_transfer_access)], status_code=204)
async def logout(request: Request, cfg: ConfigDep, resources: ResourcesDep) -> Response:
    try:
        await end_session(resources.redis, request.headers.get("X-BCC-Circle-Session", ""))
    except RedisError as exc:
        raise HTTPException(503, "circle session store unavailable") from exc
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.post("", response_model=InvitationOut, status_code=201)
async def invite(
    body: InviteRequest,
    session: SessionDep,
    cfg: ConfigDep,
    principal: CirclePrincipalDep,
    response: Response,
) -> InvitationOut:
    require_role(principal, "owner")
    response.headers["Cache-Control"] = "no-store"
    return await TrustedContactService(session, cfg).invite(principal.subject, body)


@router.get("", response_model=ContactsOut)
async def contacts(
    session: SessionDep, cfg: ConfigDep, principal: CirclePrincipalDep
) -> ContactsOut:
    require_role(principal, "owner")
    return await TrustedContactService(session, cfg).contacts(principal.subject)


@router.delete("/{contact_id}", response_model=ContactOut)
async def revoke(
    contact_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: CirclePrincipalDep,
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
    principal: CirclePrincipalDep,
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
    principal: CirclePrincipalDep,
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
    principal: CirclePrincipalDep,
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


@router.patch("/{contact_id}/preferences", response_model=ContactOut)
async def preferences(
    contact_id: uuid.UUID,
    body: ContactPreferences,
    session: SessionDep,
    cfg: ConfigDep,
    principal: CirclePrincipalDep,
    response: Response,
) -> ContactOut:
    require_role(principal, "owner")
    response.headers["Cache-Control"] = "no-store"
    row = await TrustedContactService(session, cfg).preferences(principal.subject, contact_id, body)
    return ContactOut.model_validate(row)

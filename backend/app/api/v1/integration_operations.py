import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response

from app.api.deps import SessionDep
from app.integrations.operations import JobPage, QueueSummary, jobs, queue_summary
from app.integrations.privacy import (
    PermissionHistory,
    PermissionPage,
    export_permissions,
    permission_history,
)
from app.integrations.security import ConfigDep, PrincipalDep, require_role

router = APIRouter(tags=["integration operations and privacy"])
Limit = Annotated[int, Query(ge=1, le=100)]


@router.get("/soc/operations/notifications", response_model=JobPage)
async def notifications(
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    response: Response,
    limit: Limit = 20,
    after_id: uuid.UUID | None = None,
    failed_only: bool = False,
) -> JobPage:
    require_role(principal, "soc")
    response.headers["Cache-Control"] = "no-store"
    return await jobs(session, limit, after_id, failed_only)


@router.get("/soc/operations/queue", response_model=QueueSummary)
async def queue(
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    response: Response,
) -> QueueSummary:
    require_role(principal, "soc")
    response.headers["Cache-Control"] = "no-store"
    return await queue_summary(session)


@router.get("/privacy/permissions", response_model=PermissionPage)
async def permissions(
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    response: Response,
    limit: Limit = 20,
    after_id: uuid.UUID | None = None,
) -> PermissionPage:
    require_role(principal, "owner")
    response.headers["Cache-Control"] = "no-store"
    return await export_permissions(session, principal.subject, limit, after_id)


@router.get("/privacy/contacts/{contact_id}/history", response_model=PermissionHistory)
async def history(
    contact_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    response: Response,
    limit: Limit = 20,
    after_id: uuid.UUID | None = None,
) -> PermissionHistory:
    require_role(principal, "owner")
    response.headers["Cache-Control"] = "no-store"
    return await permission_history(session, principal.subject, contact_id, limit, after_id)

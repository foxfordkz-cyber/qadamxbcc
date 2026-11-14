import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.api.deps import SessionDep
from app.api.v1.external_checks import ResourcesDep
from app.integrations.errors import IntegrationError
from app.integrations.health_details import HealthDetails, HealthSampler
from app.integrations.security import ConfigDep, PrincipalDep, require_role, verify_token
from app.integrations.timeline import TimelinePage, timeline

router = APIRouter()


@router.get("/soc/transactions/{transaction_id}/timeline", response_model=TimelinePage)
async def incident_timeline(
    transaction_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    response: Response,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
) -> TimelinePage:
    require_role(principal, "soc")
    response.headers["Cache-Control"] = "no-store"
    return await timeline(
        session, transaction_id, cfg.signing_key.get_secret_value(), limit=limit, cursor=cursor
    )


@router.get("/health/details", response_model=HealthDetails)
async def integration_health_details(
    request: Request,
    response: Response,
    resources: ResourcesDep,
    cfg: ConfigDep,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(HTTPBearer(auto_error=False))
    ],
) -> HealthDetails:
    if credentials is None:
        raise HTTPException(401, "integration capability required")
    principal = verify_token(credentials.credentials, cfg.signing_key.get_secret_value())
    require_role(principal, "soc")
    sampler = getattr(request.app.state, "integration_health_sampler", None)
    if not isinstance(sampler, HealthSampler):
        sampler = HealthSampler()
        request.app.state.integration_health_sampler = sampler
    try:
        sampler.admit(principal.subject)
    except IntegrationError as exc:
        if exc.status == 429:
            raise HTTPException(429, exc.code, headers={"Retry-After": "60"}) from None
        raise
    response.headers["Cache-Control"] = "no-store"
    return await sampler.sample(resources, cfg)

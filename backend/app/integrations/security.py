"""Short-lived, operator-issued demo capabilities. Replace with bank IAM before production."""

import hashlib
import hmac
import time
import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.exceptions import RedisError

from app.api.deps import get_resources
from app.api.security import require_transfer_access
from app.core.resources import Resources
from app.integrations.capabilities import Principal as Principal
from app.integrations.capabilities import Role as Role
from app.integrations.capabilities import issue_token as issue_token
from app.integrations.config import IntegrationSettings
from app.integrations.telegram.web_session import session_owner


def verify_token(token: str, key: str) -> Principal:
    try:
        role, subject, expires, signature = token.split(":")
        payload = f"{role}:{subject}:{expires}"
        expected = hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if len(key) < 32 or not hmac.compare_digest(signature, expected):
            raise ValueError
        if not time.time() < int(expires) <= time.time() + 3601:
            raise ValueError
        return Principal(subject=uuid.UUID(subject), role=role)  # type: ignore[arg-type]
    except (ValueError, TypeError) as exc:
        raise HTTPException(401, "invalid or expired integration capability") from exc


def config(request: Request) -> IntegrationSettings:
    cfg: IntegrationSettings = request.app.state.integration_settings
    # Demo capabilities are not bank IAM and must not open a second access path in pilot.
    if request.app.state.settings.environment == "pilot":
        raise HTTPException(503, "demo integrations unavailable in pilot")
    if not cfg.enabled:
        raise HTTPException(503, "integrations disabled")
    return cfg


ConfigDep = Annotated[IntegrationSettings, Depends(config)]
ResourcesDep = Annotated[Resources, Depends(get_resources)]
BearerDep = Annotated[HTTPAuthorizationCredentials | None, Depends(HTTPBearer(auto_error=False))]


async def authenticate(
    cfg: ConfigDep,
    resources: ResourcesDep,
    credentials: BearerDep,
) -> Principal:
    if credentials is None:
        raise HTTPException(401, "integration capability required")
    principal = verify_token(credentials.credentials, cfg.signing_key.get_secret_value())
    return await admitted_principal(principal, resources, cfg)


async def admitted_principal(
    principal: Principal, resources: Resources, cfg: IntegrationSettings
) -> Principal:
    # Atomic counter + first-use expiry; Redis failure fails closed, never bypasses a limit.
    key = f"bcc:integrations:rate:{principal.role}:{principal.subject}"
    try:
        async with resources.redis.pipeline(transaction=True) as pipe:
            pipe.incr(key)
            pipe.expire(key, 60, nx=True)
            count, _ = await pipe.execute()
    except RedisError as exc:
        raise HTTPException(503, "integration rate limiter unavailable") from exc
    if int(count) > cfg.rate_limit_per_minute:
        raise HTTPException(429, "integration rate limit exceeded", headers={"Retry-After": "60"})
    return principal


PrincipalDep = Annotated[Principal, Depends(authenticate)]


async def authenticate_circle(
    request: Request, cfg: ConfigDep, resources: ResourcesDep, credentials: BearerDep
) -> Principal:
    token = request.headers.get("X-BCC-Circle-Session")
    if token is None:
        return await authenticate(cfg, resources, credentials)
    await require_transfer_access(request, request.headers.get("X-BCC-API-Key"))
    try:
        owner = await session_owner(resources.redis, cfg, token)
    except RedisError as exc:
        raise HTTPException(503, "circle session store unavailable") from exc
    if not owner:
        raise HTTPException(401, "circle_login_required")
    return await admitted_principal(Principal(subject=owner, role="owner"), resources, cfg)


CirclePrincipalDep = Annotated[Principal, Depends(authenticate_circle)]


def require_role(principal: Principal, role: Role) -> None:
    if principal.role != role:
        raise HTTPException(403, "integration role not permitted")

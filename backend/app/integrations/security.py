"""Short-lived, operator-issued demo capabilities. Replace with bank IAM before production."""

import hashlib
import hmac
import time
import uuid
from typing import Annotated, Literal

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from redis.exceptions import RedisError

from app.api.deps import get_resources
from app.core.resources import Resources
from app.integrations.config import IntegrationSettings

Role = Literal["owner", "soc", "simulator"]


class Principal(BaseModel):
    subject: uuid.UUID
    role: Role


def issue_token(principal: Principal, key: str, *, ttl: int = 900) -> str:
    if len(key) < 32 or not 1 <= ttl <= 3600:
        raise ValueError("invalid capability configuration")
    payload = f"{principal.role}:{principal.subject}:{int(time.time()) + ttl}"
    signature = hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{signature}"


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
    if not cfg.enabled:
        raise HTTPException(503, "integrations disabled")
    return cfg


ConfigDep = Annotated[IntegrationSettings, Depends(config)]


async def authenticate(
    cfg: ConfigDep,
    resources: Annotated[Resources, Depends(get_resources)],
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(HTTPBearer(auto_error=False))
    ],
) -> Principal:
    if credentials is None:
        raise HTTPException(401, "integration capability required")
    principal = verify_token(credentials.credentials, cfg.signing_key.get_secret_value())
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


def require_role(principal: Principal, role: Role) -> None:
    if principal.role != role:
        raise HTTPException(403, "integration role not permitted")

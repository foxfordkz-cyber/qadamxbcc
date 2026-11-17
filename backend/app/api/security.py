"""Service-to-service role gates; these do not identify or authorize bank customers.

Only the trusted application server holds these credentials. Customer authentication,
account ownership and an authenticated officer session belong at that server's boundary.
"""

import secrets
from typing import Annotated, cast

from fastapi import Header, HTTPException, Request, status
from pydantic import SecretStr

from app.core.config import Settings


def _authorize(request: Request, supplied: str | None, expected: SecretStr | None) -> None:
    settings = cast(Settings, request.app.state.settings)
    if expected is None:
        if settings.environment == "pilot":
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Service access not configured"
            )
        return
    if supplied is None or not secrets.compare_digest(
        supplied.encode("utf-8"), expected.get_secret_value().encode("utf-8")
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid service credentials")


async def require_transfer_access(
    request: Request,
    key: Annotated[str | None, Header(alias="X-BCC-API-Key")] = None,
) -> None:
    settings = cast(Settings, request.app.state.settings)
    _authorize(request, key, settings.api_key)


async def require_soc_access(
    request: Request,
    key: Annotated[str | None, Header(alias="X-BCC-SOC-Key")] = None,
) -> None:
    settings = cast(Settings, request.app.state.settings)
    _authorize(request, key, settings.soc_api_key)

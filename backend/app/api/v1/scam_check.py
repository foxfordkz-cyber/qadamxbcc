"""Stateless educational API; validation must never echo submitted free text."""

from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel
from starlette.exceptions import HTTPException

from app.integrations.errors import IntegrationError
from app.integrations.scam_check import ScamCheckRequest, ScamCheckResult, analyze
from app.integrations.security import ConfigDep, PrincipalDep, require_role


class PrivateInputRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def private_handler(request: Request) -> Response:
            try:
                response = await original(request)
            except RequestValidationError:
                # FastAPI's default errors contain `input`, including entire malformed bodies.
                response = JSONResponse({"detail": "invalid_scam_check_request"}, status_code=422)
            except IntegrationError as exc:
                response = JSONResponse({"detail": exc.code}, status_code=exc.status)
                if exc.status == 429:
                    response.headers["Retry-After"] = "60"
            except HTTPException as exc:
                response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
                if exc.headers:
                    response.headers.update(exc.headers)
            response.headers["Cache-Control"] = "no-store"
            return response

        return private_handler


router = APIRouter(prefix="/guardian", tags=["Private Scam Check"], route_class=PrivateInputRoute)


class ScamCheckError(BaseModel):
    detail: str


@router.post(
    "/scam-check",
    response_model=ScamCheckResult,
    responses={status: {"model": ScamCheckError} for status in (401, 403, 422, 429, 503)},
)
async def check(body: ScamCheckRequest, cfg: ConfigDep, principal: PrincipalDep) -> ScamCheckResult:
    if principal.role != "soc":
        require_role(principal, "owner")
    return analyze(body)

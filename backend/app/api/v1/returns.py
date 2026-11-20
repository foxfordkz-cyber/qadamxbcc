import uuid
from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, Request

from app.api.deps import EngineDep, SessionDep
from app.api.v1.transfers import _http, admit_submission
from app.core.config import Settings
from app.schemas.returns import IncomingPage, IncomingPayment, ReturnAction, ReturnReview
from app.services.payment_returns import ReturnService
from app.services.recipient_flags import service_actor
from app.services.transfers import DomainError

DEMO_OWNER = uuid.UUID("00000000-0000-4000-8000-000000000001")
router = APIRouter(prefix="/returns", tags=["linked returns"])
soc_router = APIRouter(prefix="/soc/returns", tags=["linked returns"])


def test_client(request: Request, session: SessionDep) -> ReturnService:
    settings = cast(Settings, request.app.state.settings)
    # A pilot requires bank-authenticated customer identity and authoritative ledger settlement.
    if settings.environment not in ("demo", "local") or not settings.allow_demo_overrides:
        raise HTTPException(404, detail="unavailable")
    return ReturnService(session, DEMO_OWNER)


Scoped = Annotated[ReturnService, Depends(test_client)]


@router.get("/incoming")
async def incoming(service: Scoped) -> IncomingPage:
    return await service.incoming()


@router.get("/{original_id}")
async def detail(original_id: uuid.UUID, service: Scoped) -> IncomingPayment:
    try:
        return await service.detail(original_id)
    except DomainError as exc:
        raise _http(exc) from exc


@router.post("/{original_id}")
async def customer_action(
    original_id: uuid.UUID, body: ReturnAction, service: Scoped, engine: EngineDep, request: Request
) -> IncomingPayment:
    if body.action == "return_to_sender":
        await admit_submission(
            request, uuid.uuid5(uuid.NAMESPACE_OID, f"saqbol/return/{original_id}")
        )
    try:
        return await service.act(original_id, body, engine)
    except DomainError as exc:
        raise _http(exc) from exc


@soc_router.post("/{original_id}/review")
async def review(
    original_id: uuid.UUID, body: ReturnReview, service: Scoped, request: Request
) -> IncomingPayment:
    key = cast(Settings, request.app.state.settings).soc_api_key
    try:
        return await service.review(
            original_id, body, service_actor(key.get_secret_value() if key else None)
        )
    except DomainError as exc:
        raise _http(exc) from exc

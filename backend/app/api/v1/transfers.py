import re
import uuid

from fastapi import APIRouter, HTTPException, Request, status

from app.api.deps import EngineDep, SessionDep
from app.schemas.transfers import (
    AbandonRequestResponse,
    CancelTransferRequest,
    PostCallRequest,
    ResolveCoolingRequest,
    TransferEvaluateRequest,
    TransferEvaluateResponse,
)
from app.services import submission_limits
from app.services.transfers import (
    ConflictError,
    DomainError,
    InvalidTransferError,
    NotFoundError,
    TransferService,
)

router = APIRouter(prefix="/transfers", tags=["transfers"])


def _http(exc: DomainError) -> HTTPException:
    code = {
        NotFoundError: status.HTTP_404_NOT_FOUND,
        ConflictError: status.HTTP_409_CONFLICT,
        InvalidTransferError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    }.get(type(exc), status.HTTP_400_BAD_REQUEST)
    return HTTPException(status_code=code, detail=str(exc))


@router.post("/requests/{request_id}/abandon", response_model=AbandonRequestResponse)
async def abandon_request(
    request_id: uuid.UUID, session: SessionDep, engine: EngineDep
) -> AbandonRequestResponse:
    """Prevent a delayed unknown request from executing, or return its existing decision."""
    try:
        return await TransferService(session, engine).abandon(request_id)
    except DomainError as exc:
        raise _http(exc) from exc


@router.post("/evaluate", response_model=TransferEvaluateResponse)
async def evaluate_transfer(
    body: TransferEvaluateRequest, session: SessionDep, engine: EngineDep, request: Request
) -> TransferEvaluateResponse:
    """Score once per request_id; retries replay the original persisted evaluation."""
    await admit_submission(request, body.request_id)
    try:
        return await TransferService(session, engine).evaluate(body)
    except DomainError as exc:
        raise _http(exc) from exc


async def admit_submission(request: Request, request_id: uuid.UUID | None) -> None:
    source = request.headers.get("x-bcc-submission-source")
    if source is not None and request.app.state.settings.api_key:
        if not re.fullmatch(r"[a-f0-9]{64}", source):
            raise HTTPException(422, detail="invalid_submission_source")
        retry = await submission_limits.admit(request.app.state.resources.redis, source, request_id)
        if retry:
            raise HTTPException(
                429, detail="submission_cooldown", headers={"Retry-After": str(retry)}
            )


@router.get("/{transaction_id}", response_model=TransferEvaluateResponse)
async def transfer_detail(
    transaction_id: uuid.UUID, session: SessionDep, engine: EngineDep
) -> TransferEvaluateResponse:
    """Recover current lifecycle, original ML explanations and saved verification answers."""
    try:
        return await TransferService(session, engine).detail(transaction_id)
    except DomainError as exc:
        raise _http(exc) from exc


@router.post("/{transaction_id}/resolve-cooling", response_model=TransferEvaluateResponse)
async def resolve_cooling(
    transaction_id: uuid.UUID, body: ResolveCoolingRequest, session: SessionDep, engine: EngineDep
) -> TransferEvaluateResponse:
    """Save answers; release only after the deadline and explicit clean verification."""
    try:
        return await TransferService(session, engine).resolve_cooling(
            transaction_id, body.answers, save_only=body.save_only
        )
    except DomainError as exc:
        raise _http(exc) from exc


@router.post("/{transaction_id}/cancel", response_model=TransferEvaluateResponse)
async def cancel_transfer(
    transaction_id: uuid.UUID,
    session: SessionDep,
    engine: EngineDep,
    body: CancelTransferRequest | None = None,
) -> TransferEvaluateResponse:
    """Cancel a held transfer permanently, without execution; repeat cancellation is safe."""
    try:
        return await TransferService(session, engine).cancel(
            transaction_id, post_call_scam=bool(body and body.reason == "post_call_scam")
        )
    except DomainError as exc:
        raise _http(exc) from exc


@router.post("/{transaction_id}/post-call", response_model=TransferEvaluateResponse)
async def record_post_call(
    transaction_id: uuid.UUID, body: PostCallRequest, session: SessionDep, engine: EngineDep
) -> TransferEvaluateResponse:
    """Record the customer's call-ended signal or recognition of this held transfer."""
    try:
        return await TransferService(session, engine).record_post_call(transaction_id, body)
    except DomainError as exc:
        raise _http(exc) from exc

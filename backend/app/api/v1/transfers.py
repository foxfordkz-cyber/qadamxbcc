import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.deps import EngineDep, SessionDep
from app.schemas.transfers import (
    ResolveCoolingRequest,
    TransferEvaluateRequest,
    TransferEvaluateResponse,
)
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


@router.post("/evaluate", response_model=TransferEvaluateResponse)
async def evaluate_transfer(
    body: TransferEvaluateRequest, session: SessionDep, engine: EngineDep
) -> TransferEvaluateResponse:
    """Score once per request_id; retries replay the original persisted evaluation."""
    try:
        return await TransferService(session, engine).evaluate(body)
    except DomainError as exc:
        raise _http(exc) from exc


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
        return await TransferService(session, engine).resolve_cooling(transaction_id, body.answers)
    except DomainError as exc:
        raise _http(exc) from exc


@router.post("/{transaction_id}/cancel", response_model=TransferEvaluateResponse)
async def cancel_transfer(
    transaction_id: uuid.UUID, session: SessionDep, engine: EngineDep
) -> TransferEvaluateResponse:
    """Cancel a held transfer permanently, without execution; repeat cancellation is safe."""
    try:
        return await TransferService(session, engine).cancel(transaction_id)
    except DomainError as exc:
        raise _http(exc) from exc

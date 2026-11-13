import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.deps import EngineDep, SessionDep
from app.ml.model import MODEL_VERSION
from app.schemas.transfers import (
    MLContributorOut,
    PartyOut,
    ResolveCoolingRequest,
    ResolveCoolingResponse,
    RiskReasonOut,
    TransferEvaluateRequest,
    TransferEvaluateResponse,
)
from app.services.transfers import (
    ConflictError,
    DomainError,
    InvalidTransferError,
    NotFoundError,
    TransferService,
    mask_iban,
    mask_name,
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
    """Score a transfer in real time and return the adaptive decision with kk/ru reasons."""
    try:
        result = await TransferService(session, engine).evaluate(body)
    except DomainError as exc:
        raise _http(exc) from exc
    ev, tx, rcp = result.evaluation, result.transaction, result.recipient
    rg = ev.recipient_graph
    return TransferEvaluateResponse(
        transaction_id=tx.id,
        status=ev.decision,
        risk_score=ev.score,
        ml_score=ev.ml_score,
        ml_base_score=ev.ml_base_score,
        ml_model_version=MODEL_VERSION,
        ml_contributors=[
            MLContributorOut(
                feature=c.feature,
                value=c.value,
                contribution=round(c.contribution, 4),
                label_kk=c.label_kk,
                label_ru=c.label_ru,
            )
            for c in ev.ml_contributors
        ],
        headline_kk=ev.headline_kk,
        headline_ru=ev.headline_ru,
        reasons=[
            RiskReasonOut(
                code=r.code,
                layer=r.layer,
                score_delta=r.score_delta,
                reason_kk=r.reason_kk,
                reason_ru=r.reason_ru,
                evidence=r.evidence,
            )
            for r in ev.reasons
        ],
        reasons_kk=ev.reasons_kk,
        reasons_ru=ev.reasons_ru,
        latency_ms=ev.latency_ms,
        layer_latency_ms=ev.layer_latency_ms,
        cooling_off_until=tx.cooling_until,
        is_new_recipient=ev.is_new_recipient,
        is_new_device=tx.is_new_device,
        recipient=PartyOut(
            id=rcp.id, display_name=mask_name(rcp.full_name), iban_masked=mask_iban(rcp.iban)
        ),
        velocity=ev.velocity.as_dict(),
        recipient_graph={
            "in_degree": rg.in_degree,
            "out_degree": rg.out_degree,
            "in_weight": round(rg.in_weight, 2),
            "out_weight": round(rg.out_weight, 2),
            "transit_ratio": round(rg.transit_ratio, 3),
            "shared_device_accounts": rg.shared_device_accounts,
            "flagged": rg.flagged,
            "suspected_mule": rg.suspected_mule,
        },
    )


@router.post("/{transaction_id}/resolve-cooling", response_model=ResolveCoolingResponse)
async def resolve_cooling(
    transaction_id: uuid.UUID,
    body: ResolveCoolingRequest,
    session: SessionDep,
    engine: EngineDep,
) -> ResolveCoolingResponse:
    """Process the anti-scam questionnaire: any red flag blocks, a clean answer releases funds."""
    try:
        res = await TransferService(session, engine).resolve_cooling(transaction_id, body.answers)
    except DomainError as exc:
        raise _http(exc) from exc
    tx = res.transaction
    assert tx.resolved_at is not None
    return ResolveCoolingResponse(
        transaction_id=tx.id,
        status=tx.status,
        risk_score=tx.risk_score,
        headline_kk=res.headline_kk,
        headline_ru=res.headline_ru,
        red_flags=res.red_flags,
        reasons_kk=res.reasons_kk,
        reasons_ru=res.reasons_ru,
        resolved_at=tx.resolved_at,
    )

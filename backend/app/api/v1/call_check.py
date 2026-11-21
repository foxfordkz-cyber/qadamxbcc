"""«Банк мне звонит?» — the client checks a live call against the bank's outbound log."""

import uuid
from datetime import datetime
from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, Request, status
from redis.exceptions import RedisError

from app.api.deps import SessionDep, get_resources
from app.core.config import Settings
from app.core.resources import Resources
from app.models import Account
from app.schemas.call_check import (
    CallCheckRequest,
    CallCheckResponse,
    DemoBankCallRequest,
    DemoBankCallResponse,
)
from app.services.call_check import OUTBOUND_CALL_TTL_S, CallCheckService

router = APIRouter(prefix="/call-check", tags=["call-check"])
ResourcesDep = Annotated[Resources, Depends(get_resources)]

_NOT_CALLING = (
    "Журналда сізге шалынған белсенді шығыс қоңырау табылмады.",
    "В журнале нет активного исходящего звонка на ваш номер.",
)


async def _require_customer(session: SessionDep, body_id: object) -> None:
    if await session.get(Account, body_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "customer not found")


@router.post("", response_model=CallCheckResponse)
async def check_call(
    body: CallCheckRequest, session: SessionDep, resources: ResourcesDep
) -> CallCheckResponse:
    """Answer from the bank's own log; never from what the caller says."""
    await _require_customer(session, body.customer_id)
    try:
        result = await CallCheckService(resources.redis).check(body.customer_id)
    except RedisError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "call_log_unavailable") from exc
    if result.verified:
        kk = f"Журналда шығыс қоңырауы тіркелген. Қызметкер: {result.employee_name}."
        ru = f"В журнале есть исходящий звонок. Сотрудник в записи: {result.employee_name}."
    else:
        kk, ru = _NOT_CALLING
    return CallCheckResponse(
        check_id=uuid.UUID(result.check_id),
        verified=result.verified,
        employee_name=result.employee_name,
        department=result.department,
        checked_at=datetime.fromisoformat(result.checked_at),
        started_at=datetime.fromisoformat(result.started_at) if result.started_at else None,
        message_kk=kk,
        message_ru=ru,
    )


@router.post("/demo/bank-call", response_model=DemoBankCallResponse)
async def start_demo_bank_call(
    body: DemoBankCallRequest, request: Request, session: SessionDep, resources: ResourcesDep
) -> DemoBankCallResponse:
    """Demo control for «а если звонит правда банк?»; unavailable outside the demo."""
    if not cast(Settings, request.app.state.settings).allow_demo_overrides:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    await _require_customer(session, body.customer_id)
    call = await CallCheckService(resources.redis).start_bank_call(
        body.customer_id, employee_name=body.employee_name, department=body.department
    )
    return DemoBankCallResponse(
        customer_id=body.customer_id,
        employee_name=call.employee_name,
        department=call.department,
        expires_in_s=OUTBOUND_CALL_TTL_S,
    )

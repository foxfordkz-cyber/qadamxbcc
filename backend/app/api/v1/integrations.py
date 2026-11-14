import uuid
from typing import Annotated

from fastapi import APIRouter, Header
from sqlalchemy import select

from app.api.deps import SessionDep
from app.api.v1.external_checks import ResourcesDep
from app.api.v1.guardian_reports import router as reports_router
from app.api.v1.integration_insights import router as insights_router
from app.integrations.contracts import (
    EnrichmentOut,
    IntegrationHealth,
    OrchestrationRequest,
    RunOut,
)
from app.integrations.errors import IntegrationError
from app.integrations.models import ContactNotification, IntegrationAudit
from app.integrations.nbk_mock.models import ExternalCheck
from app.integrations.nbk_mock.service import GatewayService
from app.integrations.observability import health
from app.integrations.orchestrator import IntegrationOrchestrator
from app.integrations.run_model import IntegrationRun
from app.integrations.security import ConfigDep, PrincipalDep, require_role
from app.integrations.telegram.schemas import AuditOut, NotificationOut
from app.models import Transaction

router = APIRouter(prefix="/integrations", tags=["advisory orchestration"])
router.include_router(insights_router)
router.include_router(reports_router)


@router.post("/transactions/{transaction_id}", response_model=RunOut, status_code=202)
async def enqueue(
    transaction_id: uuid.UUID,
    body: OrchestrationRequest,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
    idempotency_key: Annotated[uuid.UUID, Header()],
) -> RunOut:
    require_role(principal, "owner")
    run = await IntegrationOrchestrator(session).enqueue(
        principal.subject, transaction_id, body, idempotency_key
    )
    return RunOut.model_validate(run)


@router.get("/transactions/{transaction_id}", response_model=RunOut)
async def status(
    transaction_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
) -> RunOut:
    require_role(principal, "owner")
    run = await session.scalar(
        select(IntegrationRun).where(
            IntegrationRun.transaction_id == transaction_id,
            IntegrationRun.owner_id == principal.subject,
        )
    )
    if run is None:
        raise IntegrationError(404, "integration_not_found")
    return RunOut.model_validate(run)


@router.get("/soc/transactions/{transaction_id}", response_model=EnrichmentOut)
async def soc_enrichment(
    transaction_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
) -> EnrichmentOut:
    require_role(principal, "soc")
    tx = await session.get(Transaction, transaction_id)
    if tx is None:
        raise IntegrationError(404, "transaction_not_found")
    run = await session.scalar(select(IntegrationRun).where(IntegrationRun.transaction_id == tx.id))
    notifications = list(
        (
            await session.scalars(
                select(ContactNotification)
                .where(ContactNotification.transaction_id == tx.id)
                .order_by(ContactNotification.created_at)
            )
        ).all()
    )
    checks = list(
        (
            await session.scalars(
                select(ExternalCheck)
                .where(ExternalCheck.transaction_id == tx.id)
                .order_by(ExternalCheck.created_at)
                .limit(100)
            )
        ).all()
    )
    ids = [row.id for row in notifications] + [row.id for row in checks] + ([run.id] if run else [])
    events = await session.scalars(
        select(IntegrationAudit)
        .where(IntegrationAudit.resource_id.in_(ids))
        .order_by(IntegrationAudit.created_at)
        .limit(300)
    )
    return EnrichmentOut(
        transaction_id=tx.id,
        core_status=tx.status,
        run=RunOut.model_validate(run) if run else None,
        notifications=[NotificationOut.model_validate(row) for row in notifications],
        external_checks=[GatewayService.output(row) for row in checks if row.result is not None],
        events=[AuditOut.model_validate(row) for row in events],
    )


@router.get("/health", response_model=IntegrationHealth)
async def dependency_health(
    resources: ResourcesDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
) -> IntegrationHealth:
    require_role(principal, "soc")
    return await health(resources, cfg)

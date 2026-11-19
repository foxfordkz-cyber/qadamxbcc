import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request

from app.api.deps import SessionDep, get_resources
from app.core.resources import Resources
from app.integrations.errors import IntegrationError
from app.integrations.nbk_mock.adapter import MockGatewayAdapter
from app.integrations.nbk_mock.client import GatewayClient
from app.integrations.nbk_mock.models import ExternalCheck
from app.integrations.nbk_mock.schemas import ExternalCheckOut, ExternalCheckRequest
from app.integrations.nbk_mock.service import GatewayService
from app.integrations.security import ConfigDep, PrincipalDep, require_role

router = APIRouter(
    prefix="/external-checks", tags=["MOCK enrichment — synthetic demonstration only"]
)


def gateway_client(request: Request, cfg: ConfigDep) -> GatewayClient:
    if not cfg.gateway_enabled:
        raise IntegrationError(503, "mock_gateway_disabled")
    # Explicit test/future adapter seam, never a caller-controlled provider URL.
    client: GatewayClient | None = getattr(request.app.state, "gateway_client", None)
    return client or GatewayClient(MockGatewayAdapter(), timeout=cfg.gateway_timeout_seconds)


GatewayDep = Annotated[GatewayClient, Depends(gateway_client)]
ResourcesDep = Annotated[Resources, Depends(get_resources)]


@router.post("", response_model=ExternalCheckOut)
async def check(
    body: ExternalCheckRequest,
    session: SessionDep,
    principal: PrincipalDep,
    resources: ResourcesDep,
    client: GatewayDep,
    idempotency_key: Annotated[uuid.UUID, Header()],
) -> ExternalCheckOut:
    """Synthetic advisory evidence; never an official NBK response or a payment decision."""
    require_role(principal, "owner")
    return await GatewayService(session, resources.redis, client).check(
        principal.subject,
        body,
        idempotency_key,
    )


@router.get("/{check_id}", response_model=ExternalCheckOut)
async def status(
    check_id: uuid.UUID,
    session: SessionDep,
    cfg: ConfigDep,
    principal: PrincipalDep,
) -> ExternalCheckOut:
    row = await session.get(ExternalCheck, check_id)
    if row is None or (
        principal.role != "soc" and (principal.role != "owner" or row.owner_id != principal.subject)
    ):
        raise IntegrationError(404, "external_check_not_found")
    return GatewayService.output(row)

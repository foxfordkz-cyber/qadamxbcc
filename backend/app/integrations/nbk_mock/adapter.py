from datetime import timedelta
from typing import Protocol

from app.db.base import utcnow
from app.integrations.nbk_mock.fixtures import SANDBOX
from app.integrations.nbk_mock.schemas import GatewayErrorCode, GatewayResult, GatewayStatus


class ExternalGatewayProtocol(Protocol):
    async def lookup(self, identifier: str) -> object: ...


class MockGatewayAdapter:
    """In-process sandbox, deliberately no external URL or real-provider credential."""

    async def lookup(self, identifier: str) -> object:
        status = SANDBOX.get(identifier, GatewayStatus.UNKNOWN)
        now = utcnow()
        return GatewayResult(
            identifier=identifier,
            status=status,
            markers=[
                "SYNTHETIC_NETWORK_SIGNAL"
                if identifier == "SYN-NETWORK-001"
                else "SYNTHETIC_REVIEW"
            ]
            if status == GatewayStatus.INDICATORS
            else [],
            checked_at=now,
            expires_at=now + timedelta(seconds=60),
            verified=True,
            error_code=GatewayErrorCode.UNKNOWN_IDENTIFIER
            if status == GatewayStatus.UNKNOWN
            else None,
        ).model_dump(mode="json")

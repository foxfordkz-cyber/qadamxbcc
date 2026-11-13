import asyncio
from datetime import timedelta

from app.db.base import utcnow
from app.integrations.nbk_mock.adapter import ExternalGatewayProtocol
from app.integrations.nbk_mock.errors import (
    GatewayError,
    GatewayTimeoutError,
    GatewayUnavailableError,
)
from app.integrations.nbk_mock.schemas import GatewayErrorCode, GatewayResult, GatewayStatus
from app.integrations.nbk_mock.validator import GatewayResponseValidator


def unknown(identifier: str, code: str, *, unavailable: bool = False) -> GatewayResult:
    now = utcnow()
    return GatewayResult(
        identifier=identifier,
        status=(GatewayStatus.UNAVAILABLE if unavailable else GatewayStatus.UNKNOWN),
        checked_at=now,
        expires_at=now + timedelta(seconds=5),
        verified=False,
        error_code=GatewayErrorCode(code),
    )


class GatewayClient:
    def __init__(self, adapter: ExternalGatewayProtocol, *, timeout: float = 0.2) -> None:
        self.adapter = adapter
        self.timeout = timeout
        self.validator = GatewayResponseValidator()

    async def check(self, identifier: str) -> GatewayResult:
        # Two bounded attempts for read-only transient errors. Validation failures are not retried.
        for attempt in range(2):
            try:
                async with asyncio.timeout(self.timeout):
                    raw = await self.adapter.lookup(identifier)
                return self.validator.validate(raw, identifier)
            except (TimeoutError, GatewayUnavailableError) as exc:
                if attempt == 0:
                    await asyncio.sleep(0.02)
                    continue
                code = GatewayTimeoutError.code if isinstance(exc, TimeoutError) else exc.code
                return unknown(identifier, code, unavailable=True)
            except GatewayError as exc:
                return unknown(identifier, exc.code)
            except Exception:
                return unknown(identifier, "INTERNAL_SERVICE_ERROR")
        raise AssertionError("bounded retry loop must return")

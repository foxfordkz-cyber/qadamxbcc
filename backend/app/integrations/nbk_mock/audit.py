from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.audit import record
from app.integrations.nbk_mock.models import ExternalCheck


class GatewayAuditService:
    def completed(self, session: AsyncSession, check: ExternalCheck, status: str) -> None:
        record(session, check.owner_id, check.id, check.correlation_id, f"MOCK_GATEWAY_{status}")

import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.models import IntegrationAudit

logger = logging.getLogger("bcc.integrations")


def record(
    session: AsyncSession,
    owner_id: uuid.UUID,
    resource_id: uuid.UUID,
    correlation_id: uuid.UUID,
    event: str,
) -> None:
    session.add(
        IntegrationAudit(
            owner_id=owner_id,
            resource_id=resource_id,
            correlation_id=correlation_id,
            event=event,
        )
    )
    logger.info(
        "integration_event", extra={"event_code": event, "correlation_id": str(correlation_id)}
    )

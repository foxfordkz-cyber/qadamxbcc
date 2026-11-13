import asyncio
import json
import logging
from typing import Literal

from sqlalchemy import text

from app.core.resources import Resources
from app.integrations.config import IntegrationSettings
from app.integrations.contracts import IntegrationHealth

HEARTBEAT = "bcc:integrations:worker:heartbeat"


class SafeJSONFormatter(logging.Formatter):
    """Allowlisted fields only; no messages, exceptions or arbitrary extras."""

    def format(self, record: logging.LogRecord) -> str:
        return json.dumps(
            {
                "level": record.levelname,
                "event": getattr(record, "event_code", "integration_worker"),
                "correlation_id": getattr(record, "correlation_id", None),
            }
        )


def configure_logging() -> None:
    logger = logging.getLogger("bcc.integrations")
    handler = logging.StreamHandler()
    handler.setFormatter(SafeJSONFormatter())
    logger.handlers = [handler]
    logger.propagate = False
    logger.setLevel(logging.INFO)


async def health(resources: Resources, cfg: IntegrationSettings) -> IntegrationHealth:
    database: Literal["ok", "unavailable"] = "ok"
    redis: Literal["ok", "unavailable"] = "ok"
    worker: Literal["ok", "not_seen"] = "not_seen"
    try:
        async with asyncio.timeout(0.5), resources.session_factory() as session:
            await session.execute(text("SELECT 1"))
    except Exception:
        database = "unavailable"
    try:
        async with asyncio.timeout(0.5):
            await resources.redis.ping()
            if await resources.redis.get(HEARTBEAT):
                worker = "ok"
    except Exception:
        redis = "unavailable"
    return IntegrationHealth(
        status="ok" if database == redis == worker == "ok" else "degraded",
        database=database,
        redis=redis,
        worker=worker,
        telegram_mode=cfg.telegram_mode,
        gateway="MOCK" if cfg.gateway_enabled else "disabled",
    )

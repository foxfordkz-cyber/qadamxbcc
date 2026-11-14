"""Bounded, cached SOC diagnostics; never probes the real Telegram network."""

import asyncio
import time
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import func, select

from app.core.resources import Resources
from app.db.base import utcnow
from app.integrations.config import IntegrationSettings
from app.integrations.errors import IntegrationError
from app.integrations.models import ContactNotification, IntegrationAudit
from app.integrations.observability import HEARTBEAT
from app.integrations.run_model import IntegrationRun


class QueueCounts(BaseModel):
    notifications_queued: int
    notifications_delayed: int
    notifications_failed: int
    runs_pending: int


class HealthDetails(BaseModel):
    status: Literal["ok", "degraded"]
    checked_at: datetime
    cache_seconds: Literal[5] = 5
    database: Literal["ok", "unavailable"]
    redis: Literal["ok", "unavailable"]
    worker: Literal["ok", "not_seen", "unknown"]
    telegram: Literal["disabled", "fake_enabled", "test_enabled"]
    gateway: Literal["disabled", "mock_ready"]
    queue: QueueCounts | None
    last_successful_processing: datetime | None
    real_provider_probed: Literal[False] = False


class HealthSampler:
    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.cached: HealthDetails | None = None
        self.until = 0.0
        self.budgets: dict[uuid.UUID, tuple[float, int]] = {}

    def admit(self, subject: uuid.UUID) -> None:
        # This narrowly scoped diagnostic endpoint must work while Redis is down.
        # Authentication still verifies the signed SOC capability. Its local budget
        # is bounded in time, memory and requests; all other APIs retain Redis limits.
        now = time.monotonic()
        self.budgets = {k: v for k, v in self.budgets.items() if v[0] > now}
        until, count = self.budgets.get(subject, (now + 60, 0))
        if count >= 30:
            raise IntegrationError(429, "health_rate_limit")
        if subject not in self.budgets and len(self.budgets) >= 256:
            raise IntegrationError(503, "health_capacity_reached")
        self.budgets[subject] = (until, count + 1)

    async def sample(self, resources: Resources, cfg: IntegrationSettings) -> HealthDetails:
        async with self.lock:
            if self.cached is not None and time.monotonic() < self.until:
                return self.cached
            database: Literal["ok", "unavailable"] = "ok"
            redis: Literal["ok", "unavailable"] = "ok"
            worker: Literal["ok", "not_seen", "unknown"] = "unknown"
            queue = None
            last_success = None
            try:
                async with asyncio.timeout(1), resources.session_factory() as session:
                    queued = await session.scalar(
                        select(func.count())
                        .select_from(ContactNotification)
                        .where(ContactNotification.state == "NOTIFICATION_QUEUED")
                    )
                    delayed = await session.scalar(
                        select(func.count())
                        .select_from(ContactNotification)
                        .where(
                            ContactNotification.state == "NOTIFICATION_QUEUED",
                            ContactNotification.next_attempt_at > utcnow(),
                        )
                    )
                    failed = await session.scalar(
                        select(func.count())
                        .select_from(ContactNotification)
                        .where(ContactNotification.state == "DELIVERY_FAILED")
                    )
                    runs = await session.scalar(
                        select(func.count())
                        .select_from(IntegrationRun)
                        .where(IntegrationRun.state.in_(["QUEUED", "RUNNING"]))
                    )
                    last_success = await session.scalar(
                        select(func.max(IntegrationAudit.created_at)).where(
                            IntegrationAudit.event.in_(
                                ["NOTIFICATION_SENT", "INTEGRATION_COMPLETE"]
                            )
                        )
                    )
                    queue = QueueCounts(
                        notifications_queued=queued or 0,
                        notifications_delayed=delayed or 0,
                        notifications_failed=failed or 0,
                        runs_pending=runs or 0,
                    )
            except Exception:
                database = "unavailable"
            try:
                async with asyncio.timeout(0.5):
                    await resources.redis.ping()
                    worker = "ok" if await resources.redis.get(HEARTBEAT) else "not_seen"
            except Exception:
                redis = "unavailable"
            self.cached = HealthDetails(
                status="ok" if database == redis == worker == "ok" else "degraded",
                checked_at=utcnow(),
                database=database,
                redis=redis,
                worker=worker,
                telegram="disabled"
                if not cfg.enabled or cfg.telegram_mode == "disabled"
                else "test_enabled"
                if cfg.telegram_mode == "test"
                else "fake_enabled",
                gateway="mock_ready" if cfg.gateway_enabled else "disabled",
                queue=queue,
                last_successful_processing=last_success,
            )
            self.until = time.monotonic() + 5
            return self.cached

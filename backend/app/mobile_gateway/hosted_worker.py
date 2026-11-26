"""Opt-in worker lifecycle for a single-instance synthetic staging service."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.integrations import worker
from app.integrations.config import IntegrationSettings
from app.integrations.telegram.hosted import hosted_telegram
from app.mobile_gateway.config import MobileSettings


def validate_hosted_worker(mobile: MobileSettings, core: Settings) -> None:
    if mobile.hosted_worker and (
        core.environment != "demo"
        or not core.database_url.startswith("postgresql+asyncpg://")
        or mobile.auth_mode != "password"
        or mobile.ephemeral_store
    ):
        raise ValueError("Hosted mobile worker requires persistent PostgreSQL and demo passwords")


@asynccontextmanager
async def mobile_worker(
    mobile: MobileSettings,
    core: Settings,
    config: IntegrationSettings,
    factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[None]:
    validate_hosted_worker(mobile, core)
    if not mobile.hosted_worker or not config.enabled or config.telegram_mode == "disabled":
        yield
        return
    if config.telegram_mode == "test":
        # Existing database advisory lock owns both delivery and Telegram polling.
        async with hosted_telegram(core, config, factory):
            yield
        return
    task = asyncio.create_task(worker.run())
    try:
        yield
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

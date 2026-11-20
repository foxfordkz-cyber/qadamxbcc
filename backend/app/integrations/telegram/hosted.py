"""Run one allowlisted Telegram rehearsal per database alongside a single FastAPI worker."""

import asyncio
import hashlib
import logging
import signal
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from aiogram.utils.token import TokenValidationError, extract_bot_id
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.db.session import build_engine, build_session_factory
from app.integrations import worker
from app.integrations.config import IntegrationSettings, get_integration_settings
from app.integrations.telegram import bot

logger = logging.getLogger("bcc.integrations")


def runner_key(core: Settings, config: IntegrationSettings) -> int:
    if (
        core.environment != "demo"
        or not core.database_url.startswith("postgresql+asyncpg://")
        or not config.enabled
        or config.environment != "test"
        or config.telegram_mode != "test"
        or not config.telegram_allowed_chat_ids
        or any(chat_id <= 0 for chat_id in config.telegram_allowed_chat_ids)
    ):
        raise ValueError("Hosted Telegram requires a PostgreSQL demo and a private test allowlist")
    try:
        bot_id = extract_bot_id(config.telegram_token.get_secret_value())
    except TokenValidationError:
        raise ValueError("Hosted Telegram token is invalid") from None
    # Distinct two-integer advisory-lock namespace. Only the public bot ID
    # contributes to the key, so rotating the secret retains the same lock.
    return int.from_bytes(hashlib.sha256(str(bot_id).encode()).digest()[:4], "big", signed=True)


async def _check_connection(session: AsyncSession) -> None:
    while True:
        await asyncio.sleep(2)
        async with asyncio.timeout(2):
            await session.execute(text("SELECT 1"))


async def _serve(session: AsyncSession) -> None:
    tasks = {
        asyncio.create_task(_check_connection(session)),
        asyncio.create_task(worker.run()),
        asyncio.create_task(bot.run(embedded=True)),
    }
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def _supervise(factory: async_sessionmaker[AsyncSession], key: int) -> None:
    while True:
        try:
            # An instance releases this transaction lock only after its polling
            # and delivery tasks have stopped. Postgres also releases it on disconnect.
            async with factory.begin() as session:
                async with asyncio.timeout(5):
                    acquired = await session.scalar(
                        text("SELECT pg_try_advisory_xact_lock(1111770196, :key)"), {"key": key}
                    )
                if acquired:
                    logger.info("TELEGRAM_TEST_RUNNER_ACQUIRED")
                    await _serve(session)
        except Exception:
            logger.warning("TELEGRAM_TEST_RUNNER_INTERRUPTED")
        await asyncio.sleep(3)


@asynccontextmanager
async def hosted_telegram(
    core: Settings, config: IntegrationSettings, factory: async_sessionmaker[AsyncSession]
) -> AsyncIterator[None]:
    task = asyncio.create_task(_supervise(factory, runner_key(core, config)))
    try:
        yield
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def _standalone() -> None:
    core = get_settings()
    engine = build_engine(core.database_url)
    stop = asyncio.Event()
    with suppress(NotImplementedError):
        asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, stop.set)
    try:
        async with hosted_telegram(core, get_integration_settings(), build_session_factory(engine)):
            await stop.wait()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(_standalone())

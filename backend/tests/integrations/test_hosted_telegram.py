import asyncio
from unittest.mock import AsyncMock

import pytest
from aiogram import Bot
from aiogram.types import User
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.integrations import worker
from app.integrations.config import IntegrationSettings
from app.integrations.telegram import bot, hosted


def test_hosted_runner_requires_a_private_test_environment() -> None:
    core = Settings(environment="demo", database_url="postgresql+asyncpg://local/test")
    config = IntegrationSettings(
        enabled=True,
        environment="test",
        signing_key=SecretStr("x" * 40),
        telegram_mode="test",
        telegram_token=SecretStr("12345:synthetic-fixture"),
        telegram_allowed_chat_ids=[42],
    )
    first = hosted.runner_key(core, config)
    config.telegram_token = SecretStr("12345:rotated-test-value")
    assert hosted.runner_key(core, config) == first
    config.telegram_token = SecretStr("99999:other-test-value")
    assert hosted.runner_key(core, config) != first
    with pytest.raises(ValueError, match="private test allowlist"):
        hosted.runner_key(core.model_copy(update={"environment": "pilot"}), config)
    config.telegram_allowed_chat_ids = [-42]
    with pytest.raises(ValueError, match="private test allowlist"):
        hosted.runner_key(core, config)
    config.telegram_allowed_chat_ids = [42]
    config.telegram_token = SecretStr("invalid-value-that-must-not-be-logged")
    with pytest.raises(ValueError, match="token is invalid") as error:
        hosted.runner_key(core, config)
    assert "invalid-value-that" not in str(error.value)


async def test_embedded_dispatcher_closes_its_long_poll(monkeypatch: pytest.MonkeyPatch) -> None:
    pending_update = asyncio.Event()
    closed = asyncio.Event()
    config = IntegrationSettings(
        enabled=True,
        environment="test",
        signing_key=SecretStr("x" * 40),
        telegram_mode="test",
        telegram_token=SecretStr("12143:offline-test"),
        telegram_allowed_chat_ids=[42],
    )
    monkeypatch.setattr(bot, "get_integration_settings", lambda: config)
    monkeypatch.setattr(
        bot, "get_settings", lambda: Settings(database_url="sqlite+aiosqlite:///:memory:")
    )
    monkeypatch.setattr(bot, "configure_commands", AsyncMock())
    monkeypatch.setattr(
        Bot, "me", AsyncMock(return_value=User(id=12143, is_bot=True, first_name="fixture"))
    )

    async def offline_request(*args: object, **kwargs: object) -> None:
        pending_update.set()
        try:
            await asyncio.Event().wait()
        finally:
            closed.set()

    monkeypatch.setattr(Bot, "__call__", offline_request)
    polling = asyncio.create_task(bot.run(embedded=True))
    try:
        async with asyncio.timeout(4):
            await pending_update.wait()
            polling.cancel()
            with pytest.raises(asyncio.CancelledError):
                await polling
            assert closed.is_set()
    finally:
        polling.cancel()
        await asyncio.gather(polling, return_exceptions=True)


@pytest.mark.parametrize("disconnect", [False, True], ids=["shutdown", "connection-lost"])
async def test_runner_stops_both_children(
    monkeypatch: pytest.MonkeyPatch, disconnect: bool
) -> None:
    polling = asyncio.Event()
    sending = asyncio.Event()
    closed: list[str] = []

    async def run_bot(*, embedded: bool = False) -> None:
        assert embedded
        polling.set()
        try:
            await asyncio.Event().wait()
        finally:
            closed.append("bot")

    async def run_worker() -> None:
        sending.set()
        try:
            await asyncio.Event().wait()
        finally:
            closed.append("worker")

    async def monitor(session: AsyncSession) -> None:
        await polling.wait()
        await sending.wait()
        if disconnect:
            raise ConnectionError("lost synthetic PostgreSQL connection")
        await asyncio.Event().wait()

    monkeypatch.setattr(bot, "run", run_bot)
    monkeypatch.setattr(worker, "run", run_worker)
    monkeypatch.setattr(hosted, "_check_connection", monitor)
    task = asyncio.create_task(hosted._serve(AsyncMock(spec=AsyncSession)))
    async with asyncio.timeout(3):
        await polling.wait()
        await sending.wait()
        if disconnect:
            with pytest.raises(ConnectionError):
                await task
        else:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
    assert sorted(closed) == ["bot", "worker"]


async def test_postgres_runner_lock_handoff(
    db_engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    if db_engine.dialect.name != "postgresql":
        pytest.skip("requires integration PostgreSQL")
    order: list[str] = []
    active = asyncio.Event()
    standby = asyncio.Event()

    async def serve(session: AsyncSession) -> None:
        task = asyncio.current_task()
        assert task is not None
        name = task.get_name()
        order.append(name)
        (active if name == "first" else standby).set()
        try:
            await asyncio.Event().wait()
        finally:
            order.append(f"stopped {name}")

    monkeypatch.setattr(hosted, "_serve", serve)
    factory = async_sessionmaker(db_engine)
    first = asyncio.create_task(hosted._supervise(factory, -12345), name="first")
    second: asyncio.Task[None] | None = None
    try:
        async with asyncio.timeout(10):
            await active.wait()
            second = asyncio.create_task(hosted._supervise(factory, -12345), name="second")
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(standby.wait(), timeout=0.2)
            first.cancel()
            await asyncio.gather(first, return_exceptions=True)
            await standby.wait()
            assert order == ["first", "stopped first", "second"]
    finally:
        for runner in (first, second):
            if runner is not None:
                runner.cancel()
                await asyncio.gather(runner, return_exceptions=True)

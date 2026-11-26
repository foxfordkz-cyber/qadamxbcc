import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock

import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.integrations import worker
from app.integrations.config import IntegrationSettings
from app.mobile_gateway.config import MobileSettings
from app.mobile_gateway.hosted_worker import mobile_worker, validate_hosted_worker
from scripts.prepare_staging import validate_target


def staging(**changes: Any) -> Settings:
    return Settings(
        **{
            "environment": "demo",
            "database_url": "postgresql+asyncpg://saq_bol_staging_owner:fixture@db/saq_bol_staging",
            "redis_url": "redis://cache:6379/12",
            **changes,
        }
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"database_url": "postgresql+asyncpg://saq_bol_staging_owner:fixture@db/bcc_shield"},
        {"database_url": "postgresql+asyncpg://bcc:fixture@db/saq_bol_staging"},
        {"database_url": "sqlite+aiosqlite:///saq_bol_staging"},
        {"redis_url": "redis://cache:6379/0"},
        {"redis_url": "redis://cache:6379/12?db=0"},
        {"environment": "local"},
    ],
)
def test_staging_bootstrap_rejects_shared_or_ambiguous_stores(changes: dict[str, Any]) -> None:
    validate_target(staging())
    with pytest.raises(ValueError, match="isolated"):
        validate_target(staging(**changes))


@pytest.mark.parametrize("change", [{"ephemeral_store": True}, {"auth_mode": "rehearsal"}])
def test_hosted_mobile_worker_refuses_temporary_or_code_auth(change: dict[str, Any]) -> None:
    config = MobileSettings(hosted_worker=True, auth_mode="password").model_copy(update=change)
    with pytest.raises(ValueError, match="persistent"):
        validate_hosted_worker(config, staging())
    with pytest.raises(ValueError, match="persistent"):
        validate_hosted_worker(
            MobileSettings(hosted_worker=True, auth_mode="password"),
            Settings(database_url="sqlite+aiosqlite:///:memory:"),
        )


async def test_fake_hosted_worker_stops_before_its_resources_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started, stopped = asyncio.Event(), asyncio.Event()

    async def run() -> None:
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    monkeypatch.setattr(worker, "run", run)
    config = IntegrationSettings(
        enabled=True, signing_key=SecretStr("synthetic-signing-key-123456789012345")
    )
    async with mobile_worker(
        MobileSettings(hosted_worker=True, auth_mode="password"), staging(), config, AsyncMock()
    ):
        async with asyncio.timeout(2):
            await started.wait()
    assert stopped.is_set()


async def test_live_hosted_worker_uses_existing_locked_runner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.mobile_gateway import hosted_worker as module

    visited: list[str] = []

    @asynccontextmanager
    async def locked(*args: Any) -> AsyncIterator[None]:
        visited.append("lock")
        try:
            yield
        finally:
            visited.append("unlock")

    monkeypatch.setattr(module, "hosted_telegram", locked)
    fake_run = AsyncMock()
    monkeypatch.setattr(worker, "run", fake_run)
    config = IntegrationSettings().model_copy(update={"enabled": True, "telegram_mode": "test"})
    async with mobile_worker(
        MobileSettings(hosted_worker=True, auth_mode="password"), staging(), config, AsyncMock()
    ):
        assert visited == ["lock"]
    assert visited == ["lock", "unlock"]
    fake_run.assert_not_called()


async def test_hosted_worker_remains_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    run = AsyncMock()
    monkeypatch.setattr(worker, "run", run)
    config = IntegrationSettings().model_copy(update={"enabled": True})
    async with mobile_worker(MobileSettings(), staging(), config, AsyncMock()):
        pass
    run.assert_not_called()

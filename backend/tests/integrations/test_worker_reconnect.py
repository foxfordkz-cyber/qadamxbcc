import asyncio
from unittest.mock import AsyncMock

import pytest

from app.integrations.telegram import worker
from tests.integrations.conftest import IntegrationWorld


async def test_delivery_loop_recovers_after_database_disconnect(
    iw: IntegrationWorld,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    engine = AsyncMock()
    deliver = AsyncMock(side_effect=[RuntimeError("private-db-password"), True])
    monkeypatch.setattr(worker, "get_integration_settings", lambda: iw.cfg)
    monkeypatch.setattr(worker, "build_engine", lambda _: engine)
    monkeypatch.setattr(worker, "build_session_factory", lambda _: iw.factory)
    monkeypatch.setattr(worker, "deliver_one", deliver)

    async def stop_after_recovery(_: float) -> None:
        if deliver.await_count == 2:
            raise asyncio.CancelledError

    monkeypatch.setattr("app.integrations.telegram.worker.asyncio.sleep", stop_after_recovery)
    with pytest.raises(asyncio.CancelledError):
        await worker.run()
    assert deliver.await_count == 2
    engine.dispose.assert_awaited_once()
    assert "private-db-password" not in caplog.text
    assert "DELIVERY_DEPENDENCY_ERROR" in caplog.text


async def test_once_worker_failure_exits_without_provider_details(
    iw: IntegrationWorld,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(worker, "get_integration_settings", lambda: iw.cfg)
    monkeypatch.setattr(worker, "build_engine", lambda _: AsyncMock())
    monkeypatch.setattr(worker, "build_session_factory", lambda _: iw.factory)
    monkeypatch.setattr(
        worker, "deliver_one", AsyncMock(side_effect=RuntimeError("private-db-password"))
    )
    with pytest.raises(SystemExit) as error:
        await worker.run(once=True)
    assert error.value.code == 1
    assert "private-db-password" not in caplog.text

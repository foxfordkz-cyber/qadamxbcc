import uuid
from datetime import timedelta
from typing import Any

import pytest

from app.db.base import utcnow
from app.integrations import orchestrator
from app.integrations.run_model import IntegrationRun
from tests.integrations.conftest import IntegrationWorld
from tests.integrations.test_orchestration import enqueue, process


async def test_recovered_run_clears_current_error_but_preserves_audit(
    iw: IntegrationWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    tx = await iw.transfer()
    queued = await enqueue(iw, tx["transaction_id"])
    original = orchestrator._process
    calls = 0

    async def interrupted(*args: Any, **kwargs: Any) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("synthetic first-attempt interruption")
        await original(*args, **kwargs)

    monkeypatch.setattr(orchestrator, "_process", interrupted)
    await process(iw)
    async with iw.factory() as session:
        run = await session.get(IntegrationRun, uuid.UUID(queued["id"]))
        assert run
        assert run.error_code == "INTEGRATION_WORKER_ERROR"
        run.next_attempt_at = utcnow() - timedelta(seconds=1)
        await session.commit()
    await process(iw)
    response = await iw.client.get(
        f"/api/v1/integrations/soc/transactions/{tx['transaction_id']}", headers=iw.auth("soc")
    )
    data = response.json()
    assert data["run"]["state"] == "COMPLETE"
    assert data["run"]["error_code"] is None
    assert data["run"]["attempts"] == 2
    assert any(event["event"] == "INTEGRATION_QUEUED" for event in data["events"])
    assert data["core_status"] == tx["status"]

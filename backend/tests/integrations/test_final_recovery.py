import uuid
from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import func, select

from app.db.base import utcnow
from app.integrations import orchestrator
from app.integrations.contracts import OrchestrationRequest
from app.integrations.models import IntegrationAudit
from app.integrations.run_model import IntegrationRun
from app.models import Transaction
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


async def test_outbox_and_audit_rollback_together_on_commit_failure(
    iw: IntegrationWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    tx = await iw.transfer()
    async with iw.factory() as session:

        async def fail_commit() -> None:
            await session.flush()
            raise RuntimeError("synthetic commit failure")

        monkeypatch.setattr(session, "commit", fail_commit)
        with pytest.raises(RuntimeError, match="synthetic commit failure"):
            await orchestrator.IntegrationOrchestrator(session).enqueue(
                iw.owner.id,
                uuid.UUID(str(tx["transaction_id"])),
                OrchestrationRequest(gateway_identifier="SYN-CLEAR-001"),
                uuid.uuid4(),
            )
    async with iw.factory() as session:
        assert await session.scalar(select(func.count()).select_from(IntegrationRun)) == 0
        assert await session.scalar(select(func.count()).select_from(IntegrationAudit)) == 0
        stored = await session.get(Transaction, uuid.UUID(str(tx["transaction_id"])))
        assert stored
        assert stored.status == tx["status"]
        assert stored.risk_score == tx["risk_score"]
    assert not await process(iw)
    assert not iw.adapter.messages

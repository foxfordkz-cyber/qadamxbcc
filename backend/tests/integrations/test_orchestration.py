import logging
import uuid
from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import func, select

from app.db.base import utcnow
from app.integrations.nbk_mock.adapter import MockGatewayAdapter
from app.integrations.nbk_mock.client import GatewayClient
from app.integrations.nbk_mock.models import ExternalCheck
from app.integrations.observability import HEARTBEAT, SafeJSONFormatter
from app.integrations.orchestrator import process_one
from app.integrations.run_model import IntegrationRun
from app.models import Transaction, TransactionStatus
from tests.integrations.conftest import IntegrationWorld
from tests.integrations.test_nbk_gateway import InjectedAdapter

ROOT = "/api/v1/integrations"


async def enqueue(
    iw: IntegrationWorld,
    transaction: object,
    contact: str | None = None,
    key: uuid.UUID | None = None,
) -> dict[str, Any]:
    response = await iw.client.post(
        f"{ROOT}/transactions/{transaction}",
        headers={**iw.auth(), "Idempotency-Key": str(key or uuid.uuid4())},
        json={"contact_id": contact, "gateway_identifier": "SYN-REVIEW-001"},
    )
    assert response.status_code == 202, response.text
    result: dict[str, Any] = response.json()
    return result


async def process(iw: IntegrationWorld, client: GatewayClient | None = None) -> bool:
    return await process_one(
        iw.factory, iw.redis, iw.cfg, client or GatewayClient(MockGatewayAdapter())
    )


async def test_e2e_cooling_consent_delivery_suspicion_and_soc(iw: IntegrationWorld) -> None:
    contact = await iw.verified("kk")
    tx = await iw.transfer()
    job = await enqueue(iw, tx["transaction_id"], contact)
    assert job["state"] == "QUEUED"
    assert not iw.adapter.messages
    assert await process(iw)
    assert await iw.deliver()
    soc = await iw.client.get(
        f"{ROOT}/soc/transactions/{tx['transaction_id']}", headers=iw.auth("soc")
    )
    data = soc.json()
    assert data["core_status"] == "cooling_off"
    assert data["run"]["state"] == "COMPLETE"
    assert data["external_checks"][0]["result"]["source"] == "MOCK"
    notification = data["notifications"][0]
    assert notification["state"] == "NOTIFICATION_SENT"
    assert notification["correlation_id"] == job["correlation_id"]
    assert data["external_checks"][0]["correlation_id"] == job["correlation_id"]
    response = await iw.client.post(
        "/api/v1/trusted-contacts/simulator/update",
        headers=iw.auth("simulator"),
        json={
            "kind": "suspect",
            "chat_id": 123,
            "reference": notification["id"],
            "message_id": str(uuid.UUID(notification["id"]).int % 2_000_000_000),
        },
    )
    assert response.status_code == 200
    async with iw.factory() as session:
        stored = await session.get(Transaction, uuid.UUID(str(tx["transaction_id"])))
        assert stored
        assert stored.status == TransactionStatus.COOLING_OFF
        assert stored.risk_score == tx["risk_score"]
        assert await session.scalar(select(func.count()).select_from(Transaction)) == 1
    soc = await iw.client.get(
        f"{ROOT}/soc/transactions/{tx['transaction_id']}", headers=iw.auth("soc")
    )
    assert soc.json()["notifications"][0]["state"] == "SUSPICION_REPORTED"
    assert all(
        private not in soc.text for private in (iw.owner.iin, iw.owner.iban, iw.recipient.phone)
    )


async def test_duplicate_events_and_payload_conflicts(iw: IntegrationWorld) -> None:
    tx = await iw.transfer()
    key = uuid.uuid4()
    first = await enqueue(iw, tx["transaction_id"], key=key)
    assert (await enqueue(iw, tx["transaction_id"], key=key))["id"] == first["id"]
    assert (await enqueue(iw, tx["transaction_id"]))["id"] == first["id"]
    response = await iw.client.post(
        f"{ROOT}/transactions/{tx['transaction_id']}",
        headers={**iw.auth(), "Idempotency-Key": str(key)},
        json={"gateway_identifier": "SYN-CLEAR-001"},
    )
    assert response.status_code == 409
    assert await process(iw)
    assert not await process(iw)


@pytest.mark.parametrize("scenario", ["no_consent", "approved", "revoked", "disabled"])
async def test_contact_gates_in_orchestration(iw: IntegrationWorld, scenario: str) -> None:
    if scenario == "no_consent":
        invite = await iw.invite()
        contact = str(invite["contact"]["id"])  # type: ignore[index]
    else:
        contact = await iw.verified()
    if scenario == "revoked":
        await iw.client.delete(f"/api/v1/trusted-contacts/{contact}", headers=iw.auth())
    if scenario == "disabled":
        iw.cfg.telegram_mode = "disabled"
    tx = await iw.transfer(cooling=scenario != "approved")
    await enqueue(iw, tx["transaction_id"], contact)
    await process(iw)
    await iw.deliver()
    response = await iw.client.get(f"{ROOT}/transactions/{tx['transaction_id']}", headers=iw.auth())
    expected = {
        "no_consent": "CONTACT_PENDING_CONSENT",
        "approved": "SKIPPED_NOT_COOLING",
        "revoked": "CONTACT_REVOKED",
        "disabled": "INTEGRATION_DISABLED",
    }
    assert response.json()["contact_outcome"] == expected[scenario]
    assert not iw.adapter.messages


async def test_gateway_failure_does_not_prevent_contact_or_scoring(iw: IntegrationWorld) -> None:
    contact = await iw.verified()
    tx = await iw.transfer()
    await enqueue(iw, tx["transaction_id"], contact)
    await process(iw, GatewayClient(InjectedAdapter("timeout"), timeout=0.01))
    await iw.deliver()
    response = await iw.client.get(
        f"{ROOT}/soc/transactions/{tx['transaction_id']}", headers=iw.auth("soc")
    )
    data = response.json()
    assert data["run"]["state"] == "DEGRADED"
    assert data["external_checks"][0]["result"]["status"] == "UNAVAILABLE"
    assert data["notifications"][0]["state"] == "NOTIFICATION_SENT"
    assert data["core_status"] == "cooling_off"


async def test_delivery_failure_remains_visible_to_soc(iw: IntegrationWorld) -> None:
    contact = await iw.verified()
    tx = await iw.transfer()
    await enqueue(iw, tx["transaction_id"], contact)
    await process(iw)
    iw.adapter.fail = True
    await iw.deliver()
    response = await iw.client.get(
        f"{ROOT}/soc/transactions/{tx['transaction_id']}", headers=iw.auth("soc")
    )
    assert response.json()["notifications"][0]["state"] == "DELIVERY_FAILED"
    assert response.json()["core_status"] == "cooling_off"


async def test_worker_restart_replays_safely(iw: IntegrationWorld) -> None:
    contact = await iw.verified()
    tx = await iw.transfer()
    queued = await enqueue(iw, tx["transaction_id"], contact)
    await process(iw)
    await iw.deliver()
    async with iw.factory() as session:
        run = await session.get(IntegrationRun, uuid.UUID(queued["id"]))
        assert run
        run.state = "RUNNING"
        run.claimed_at = utcnow() - timedelta(seconds=31)
        await session.commit()
    assert await process(iw)
    assert not await iw.deliver()
    assert len(iw.adapter.messages) == 1
    async with iw.factory() as session:
        assert await session.scalar(select(func.count()).select_from(ExternalCheck)) == 1


async def test_worker_retries_are_bounded(
    iw: IntegrationWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    tx = await iw.transfer()
    queued = await enqueue(iw, tx["transaction_id"])
    failing = AsyncMock(side_effect=RuntimeError("do not log this secret"))
    monkeypatch.setattr("app.integrations.orchestrator._process", failing)
    for _ in range(3):
        assert await process(iw)
        async with iw.factory() as session:
            run = await session.get(IntegrationRun, uuid.UUID(queued["id"]))
            assert run
            run.next_attempt_at = utcnow() - timedelta(seconds=1)
            await session.commit()
    assert not await process(iw)
    response = await iw.client.get(f"{ROOT}/transactions/{tx['transaction_id']}", headers=iw.auth())
    assert response.json()["state"] == "FAILED"
    assert response.json()["attempts"] == 3
    assert "secret" not in response.text


async def test_scoring_and_enqueue_never_call_gateway(iw: IntegrationWorld) -> None:
    adapter = InjectedAdapter("timeout")
    iw.app.state.gateway_client = GatewayClient(adapter)
    tx = await iw.transfer()
    await enqueue(iw, tx["transaction_id"])
    assert adapter.calls == 0
    assert not iw.adapter.messages


async def test_soc_requires_soc_role_and_owner_is_scoped(iw: IntegrationWorld) -> None:
    tx = await iw.transfer()
    await enqueue(iw, tx["transaction_id"])
    response = await iw.client.get(
        f"{ROOT}/soc/transactions/{tx['transaction_id']}", headers=iw.auth()
    )
    assert response.status_code == 403
    response = await iw.client.get(
        f"{ROOT}/transactions/{tx['transaction_id']}", headers=iw.auth(subject=iw.recipient.id)
    )
    assert response.status_code == 404


async def test_dependency_health(iw: IntegrationWorld) -> None:
    response = await iw.client.get(f"{ROOT}/health", headers=iw.auth("soc"))
    assert response.json()["worker"] == "not_seen"
    await iw.redis.set(HEARTBEAT, "ok", ex=30)
    response = await iw.client.get(f"{ROOT}/health", headers=iw.auth("soc"))
    assert response.json()["status"] == "ok"
    assert response.json()["gateway"] == "MOCK"


async def test_limiter_failure_is_closed(
    iw: IntegrationWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(iw.redis, "pipeline", Mock(side_effect=RedisConnectionError("private")))
    response = await iw.client.get(f"{ROOT}/health", headers=iw.auth("soc"))
    assert response.status_code == 503
    assert "private" not in response.text
    assert (await iw.client.get("/health")).status_code == 200


def test_structured_logs_allowlist_fields() -> None:
    record = logging.LogRecord(
        "bcc.integrations", logging.WARNING, "unused", 1, "secret token and PII", (), None
    )
    record.event_code = "INTEGRATION_COMPLETE"
    record.correlation_id = str(uuid.uuid4())
    record.telegram_token = "never-serialize"
    rendered = SafeJSONFormatter().format(record)
    assert "INTEGRATION_COMPLETE" in rendered
    assert "secret" not in rendered
    assert "never-serialize" not in rendered

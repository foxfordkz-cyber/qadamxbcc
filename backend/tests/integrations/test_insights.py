import asyncio
import uuid
from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import func, select

from app.db.base import utcnow
from app.integrations.health_details import HealthSampler
from app.integrations.models import ContactNotification, IntegrationAudit
from app.integrations.observability import HEARTBEAT
from tests.integrations.conftest import IntegrationWorld
from tests.integrations.test_orchestration import enqueue, process

ROOT = "/api/v1/integrations"


@pytest.mark.parametrize("endpoint", ["timeline", "health"])
@pytest.mark.parametrize("role", ["owner", "simulator"])
async def test_insights_require_soc(iw: IntegrationWorld, endpoint: str, role: str) -> None:
    path = (
        f"{ROOT}/health/details"
        if endpoint == "health"
        else f"{ROOT}/soc/transactions/{uuid.uuid4()}/timeline"
    )
    headers = iw.auth("owner" if role == "owner" else "simulator")
    assert (await iw.client.get(path, headers=headers)).status_code == 403
    assert (await iw.client.get(path)).status_code == 401


async def test_timeline_reuses_persisted_history_and_paginates(iw: IntegrationWorld) -> None:
    contact = await iw.verified()
    tx = await iw.transfer()
    job = await enqueue(iw, tx["transaction_id"], contact)
    await process(iw)
    await iw.deliver()
    soc = (
        await iw.client.get(
            f"{ROOT}/soc/transactions/{tx['transaction_id']}", headers=iw.auth("soc")
        )
    ).json()
    notification = soc["notifications"][0]["id"]
    for action in ["ack", "suspect", "suspect"]:
        response = await iw.client.post(
            "/api/v1/trusted-contacts/simulator/update",
            headers=iw.auth("simulator"),
            json={
                "kind": action,
                "reference": notification,
                "chat_id": 123,
                "message_id": str(uuid.UUID(notification).int % 2_000_000_000),
            },
        )
        assert response.status_code == 200
    async with iw.factory() as session:
        before = await session.scalar(select(func.count()).select_from(IntegrationAudit))
    path = f"{ROOT}/soc/transactions/{tx['transaction_id']}/timeline"
    all_events: list[dict[str, Any]] = []
    params: dict[str, Any] = {"limit": 2}
    for _ in range(20):
        response = await iw.client.get(path, headers=iw.auth("soc"), params=params)
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        page = response.json()
        assert len(page["events"]) <= 2
        all_events.extend(page["events"])
        if page["next_cursor"] is None:
            break
        params["cursor"] = page["next_cursor"]
    else:
        pytest.fail("Pagination did not terminate")
    codes = [e["code"] for e in all_events]
    for code in [
        "TRANSFER_EVALUATED",
        "DECISION_COOLING_OFF",
        "COOLING_STARTED",
        "NOTIFICATION_QUEUED",
        "NOTIFICATION_SENT",
        "CONTACT_ACKNOWLEDGED",
        "SUSPICION_REPORTED",
        "MOCK_GATEWAY_INDICATORS",
        "INTEGRATION_COMPLETE",
    ]:
        assert codes.count(code) == 1
    assert len({e["id"] for e in all_events}) == len(all_events)
    assert [(e["timestamp"], e["id"]) for e in all_events] == sorted(
        (e["timestamp"], e["id"]) for e in all_events
    )
    assert all(e["description_ru"] and e["description_kk"] for e in all_events)
    assert any(e["correlation_id"] == job["correlation_id"] for e in all_events)
    assert not any("chat_id" in e or "token" in e for e in all_events)
    async with iw.factory() as session:
        after = await session.scalar(select(func.count()).select_from(IntegrationAudit))
    assert before == after  # projection never writes audit duplicates


@pytest.mark.parametrize("limit", [0, 101, -1])
async def test_timeline_rejects_unbounded_page(iw: IntegrationWorld, limit: int) -> None:
    response = await iw.client.get(
        f"{ROOT}/soc/transactions/{uuid.uuid4()}/timeline",
        params={"limit": limit},
        headers=iw.auth("soc"),
    )
    assert response.status_code == 422


async def test_timeline_cursor_binding_and_tampering(iw: IntegrationWorld) -> None:
    tx = await iw.transfer()
    path = f"{ROOT}/soc/transactions/{tx['transaction_id']}/timeline"
    page = (await iw.client.get(path, headers=iw.auth("soc"), params={"limit": 1})).json()
    cursor = page["next_cursor"]
    assert cursor
    assert (
        await iw.client.get(path, headers=iw.auth("soc"), params={"cursor": cursor + "bad"})
    ).status_code == 422
    other = await iw.transfer(cooling=False)
    assert (
        await iw.client.get(
            f"{ROOT}/soc/transactions/{other['transaction_id']}/timeline",
            headers=iw.auth("soc"),
            params={"cursor": cursor},
        )
    ).status_code == 422
    assert (
        await iw.client.get(
            f"{ROOT}/soc/transactions/{uuid.uuid4()}/timeline", headers=iw.auth("soc")
        )
    ).status_code == 404


async def test_timeline_preserves_initial_cooling_after_core_resolution(
    iw: IntegrationWorld,
) -> None:
    tx = await iw.transfer()
    response = await iw.client.post(
        f"/api/v1/transfers/{tx['transaction_id']}/resolve-cooling",
        json={
            "answers": {
                "caller_claims_bank_or_police": True,
                "asked_to_move_to_safe_account": True,
                "asked_to_keep_secret_or_install_app": True,
                "initiated_by_customer": False,
                "knows_recipient_personally": False,
            }
        },
    )
    assert response.status_code == 200
    page = (
        await iw.client.get(
            f"{ROOT}/soc/transactions/{tx['transaction_id']}/timeline", headers=iw.auth("soc")
        )
    ).json()
    codes = [e["code"] for e in page["events"]]
    assert "DECISION_COOLING_OFF" in codes
    assert "DECISION_BLOCKED" not in codes  # do not mislabel the historical initial decision
    assert "COOLING_RESOLVED" in codes


async def test_health_counts_cache_and_no_secrets(
    iw: IntegrationWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    row = await iw.queue(await iw.verified())
    async with iw.factory() as session:
        saved = await session.get(ContactNotification, uuid.UUID(str(row["id"])))
        assert saved is not None
        saved.next_attempt_at = utcnow() + timedelta(seconds=120)
        await session.commit()
    await iw.redis.set(HEARTBEAT, "ok", ex=30)
    original_ping = iw.redis.ping

    async def ping_real() -> object:
        return await original_ping()

    ping = AsyncMock(side_effect=ping_real)
    monkeypatch.setattr(iw.redis, "ping", ping)
    first = await iw.client.get(f"{ROOT}/health/details", headers=iw.auth("soc"))
    second = await iw.client.get(f"{ROOT}/health/details", headers=iw.auth("soc"))
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert ping.await_count == 1
    data = first.json()
    assert data["status"] == "ok"
    assert data["queue"]["notifications_queued"] == 1
    assert data["queue"]["notifications_delayed"] == 1
    assert data["telegram"] == "fake_enabled"
    assert data["gateway"] == "mock_ready"
    assert data["real_provider_probed"] is False
    assert data["last_successful_processing"] is None
    assert "signing_key" not in first.text
    assert "telegram_token" not in first.text


async def test_health_available_during_redis_failure_without_auth_bypass(
    iw: IntegrationWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unavailable_pipeline(*args: Any, **kwargs: Any) -> None:
        raise RedisConnectionError("private-redis-credential")

    monkeypatch.setattr(iw.redis, "pipeline", unavailable_pipeline)
    monkeypatch.setattr(
        iw.redis, "ping", AsyncMock(side_effect=RuntimeError("private-redis-credential"))
    )
    response = await iw.client.get(f"{ROOT}/health/details", headers=iw.auth("soc"))
    assert response.status_code == 200
    assert response.json()["redis"] == "unavailable"
    assert response.json()["worker"] == "unknown"
    assert response.json()["status"] == "degraded"
    assert "private-redis-credential" not in response.text
    assert (await iw.client.get("/api/v1/trusted-contacts", headers=iw.auth())).status_code == 503
    assert (
        await iw.client.get(f"{ROOT}/health/details", headers={"Authorization": "Bearer invalid"})
    ).status_code == 401


async def test_health_database_failure_and_recovery(iw: IntegrationWorld) -> None:
    resources = iw.app.state.resources
    factory = resources.session_factory

    def failing() -> None:
        raise RuntimeError("private-db-credential")

    resources.session_factory = failing
    response = await iw.client.get(f"{ROOT}/health/details", headers=iw.auth("soc"))
    assert response.json()["database"] == "unavailable"
    assert response.json()["queue"] is None
    assert "private-db-credential" not in response.text
    resources.session_factory = factory
    sampler: HealthSampler = iw.app.state.integration_health_sampler
    sampler.until = 0
    response = await iw.client.get(f"{ROOT}/health/details", headers=iw.auth("soc"))
    assert response.json()["database"] == "ok"


async def test_health_budget_remains_bounded_without_redis(iw: IntegrationWorld) -> None:
    for _ in range(30):
        assert (
            await iw.client.get(f"{ROOT}/health/details", headers=iw.auth("soc"))
        ).status_code == 200
    assert (
        await iw.client.get(f"{ROOT}/health/details", headers=iw.auth("soc"))
    ).status_code == 429


async def test_timeline_tied_timestamps_snapshot_and_unknown_event_privacy(
    iw: IntegrationWorld,
) -> None:
    row = await iw.queue(await iw.verified())
    at = utcnow()
    async with iw.factory() as session:
        session.add_all(
            [
                IntegrationAudit(
                    id=uuid.UUID(int=i),
                    owner_id=iw.owner.id,
                    resource_id=uuid.UUID(str(row["id"])),
                    correlation_id=uuid.uuid4(),
                    event="PRIVATE_TOKEN_EXAMPLE",
                    created_at=at,
                )
                for i in range(1, 10)
            ]
        )
        await session.commit()
    path = f"{ROOT}/soc/transactions/{row['transaction_id']}/timeline"
    first = (await iw.client.get(path, headers=iw.auth("soc"), params={"limit": 2})).json()
    late_id = uuid.uuid4()
    async with iw.factory() as session:
        session.add(
            IntegrationAudit(
                id=late_id,
                owner_id=iw.owner.id,
                resource_id=uuid.UUID(str(row["id"])),
                correlation_id=uuid.uuid4(),
                event="PRIVATE_LATE_EVENT",
                created_at=utcnow(),
            )
        )
        await session.commit()
    events = first["events"]
    cursor = first["next_cursor"]
    while cursor:
        response = await iw.client.get(
            path, headers=iw.auth("soc"), params={"limit": 2, "cursor": cursor}
        )
        assert "PRIVATE_" not in response.text
        page = response.json()
        assert page["as_of"] == first["as_of"]
        events.extend(page["events"])
        cursor = page["next_cursor"]
    assert len(events) == 13  # core 3 + original queued audit + nine tied audit rows
    assert len({e["id"] for e in events}) == 13
    assert f"audit:{late_id.hex}" not in {e["id"] for e in events}


async def test_concurrent_health_requests_share_one_probe(
    iw: IntegrationWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    ping = AsyncMock(return_value=True)
    monkeypatch.setattr(iw.redis, "ping", ping)
    responses = await asyncio.gather(
        *(iw.client.get(f"{ROOT}/health/details", headers=iw.auth("soc")) for _ in range(5))
    )
    assert all(r.status_code == 200 for r in responses)
    assert len({r.json()["checked_at"] for r in responses}) == 1
    assert ping.await_count == 1

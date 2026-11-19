"""Concurrency and final-authorization regressions using isolated test resources."""

import asyncio
import uuid
from typing import Any, cast

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.transfers as transfers
from app.core.resources import Resources
from app.models import AbandonedRequest, GraphEdge, ProjectionEvent, Transaction
from app.services.graph import MAX_GRAPH_NEIGHBOURS
from tests.clock import pin_server_clock
from tests.test_api import CLEAN, DAY, World
from tests.test_api import world as world


def _resources(world: World) -> Resources:
    return cast(Resources, cast(Any, world.client._transport).app.state.resources)


def _normal_request(world: World) -> dict[str, str]:
    return {
        "request_id": str(uuid.uuid4()),
        "sender_id": world.id("alice"),
        "recipient_id": world.id("bob"),
        "amount": "1000",
    }


async def test_pilot_context_never_promotes_forged_device_ids_live_or_after_restart(
    world: World,
) -> None:
    resources = _resources(world)
    resources.engine.allow_demo_overrides = False
    forged = world.acc["scammer"].device_id
    for name in ("victim", "dana", "feeder0"):
        response = await world.evaluate(
            name, "bob", 1000, device_id=forged, context={"is_new_device": False}
        )
        assert response["is_new_device"] is True
    expected = {world.id("scammer")}
    assert resources.engine.graph.accounts_on_device(forged) == expected
    await resources.start()
    assert resources.engine.graph.accounts_on_device(forged) == expected


async def test_graph_overload_returns_503_without_creating_a_transfer_decision(
    world: World,
) -> None:
    resources = _resources(world)
    for index in range(MAX_GRAPH_NEIGHBOURS + 1):
        resources.engine.graph.add_transfer(f"synthetic-{index}", world.id("bob"), 1000)
    response = await world.client.post("/api/v1/transfers/evaluate", json=_normal_request(world))
    assert response.status_code == 503
    graph = await world.client.get(f"/api/v1/soc/graph/{world.id('bob')}")
    assert graph.status_code == 503
    async with world.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Transaction)) == 0


async def test_read_session_cannot_rollback_pending_evaluation(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    written, resume = asyncio.Event(), asyncio.Event()
    original = transfers.upsert_transfer_edge

    async def paused(*args: Any, **kwargs: Any) -> None:
        await original(*args, **kwargs)
        written.set()
        await resume.wait()

    monkeypatch.setattr(transfers, "upsert_transfer_edge", paused)
    writer = asyncio.create_task(world.evaluate("alice", "bob", 1000))
    await asyncio.wait_for(written.wait(), 5)
    reader = asyncio.create_task(world.client.get("/api/v1/soc/feed"))
    try:
        await asyncio.sleep(0.05)
        assert not reader.done(), "The one memory connection must not be leased concurrently"
    finally:
        resume.set()
    result, feed = await asyncio.gather(writer, reader)
    assert result["status"] == "approved"
    assert feed.json()["stats"]["total"] == 1
    async with world.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Transaction)) == 1
        edge = (await session.execute(select(GraphEdge))).scalar_one()
        assert edge.weight == 31_000


async def test_release_rechecks_new_dropper_network_without_new_attempt(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Keep the intended daytime cashout and its settled velocity on the same clock.
    pin_server_clock(monkeypatch, DAY)
    held = await world.evaluate(
        "victim", "scammer", 900_000, context={"active_call": True, "from_deposit": True}
    )
    assert held["status"] == "cooling_off"
    for i in range(12):
        received = await world.evaluate(f"feeder{i}", "scammer", 90_000)
        if received["status"] == "cooling_off":
            await world.expire_hold(received["transaction_id"])
            received = (
                await world.client.post(
                    f"/api/v1/transfers/{received['transaction_id']}/resolve-cooling",
                    json={"answers": CLEAN},
                )
            ).json()
        assert received["status"] == "approved"
    cashout = await world.evaluate("scammer", "cashout", 1_000_000)
    assert cashout["status"] == "cooling_off"
    await world.expire_hold(cashout["transaction_id"])
    assert (
        await world.client.post(
            f"/api/v1/transfers/{cashout['transaction_id']}/resolve-cooling",
            json={"answers": CLEAN},
        )
    ).json()["status"] == "approved"
    fresh = await world.evaluate("dana", "scammer", 250_000)
    assert fresh["status"] == "blocked"
    await _resources(world).redis.flushdb()
    assert (await world.client.get("/ready")).status_code == 200
    restored = await world.evaluate("dana", "scammer", 250_000)
    assert restored["status"] == "blocked"
    assert restored["velocity"]["settled_recipient_in"]["1h"]["distinct"] == 12
    await world.expire_hold(held["transaction_id"])
    released = await world.client.post(
        f"/api/v1/transfers/{held['transaction_id']}/resolve-cooling", json={"answers": CLEAN}
    )
    assert released.status_code == 200
    result = released.json()
    assert result["status"] == "blocked"
    assert result["ml_score"] == held["ml_score"], "Keep the original decision snapshot immutable"
    audit = next(reason for reason in result["reasons"] if reason["code"] == "RELEASE_REVALIDATED")
    assert audit["evidence"]["status"] == "blocked"
    assert audit["evidence"]["ml_model_version"]
    assert audit["evidence"]["velocity"]["sender_out"]["24h"]["count"] == 1
    assert any(reason["code"] == "RELEASE_NETWORK_BLOCKED" for reason in result["reasons"])
    async with world.sessions() as session:
        count = await session.scalar(
            select(func.count())
            .select_from(GraphEdge)
            .where(GraphEdge.source_id == world.acc["victim"].id)
        )
        assert count == 0


@pytest.mark.parametrize("recovery", ["ready", "graph", "restart"])
async def test_commit_ack_loss_recovers_before_readiness_and_retry(
    world: World,
    monkeypatch: pytest.MonkeyPatch,
    recovery: str,
) -> None:
    body = _normal_request(world)
    resources = _resources(world)
    original = AsyncSession.commit

    async def lost_ack(session: AsyncSession) -> None:
        await original(session)
        raise asyncio.CancelledError("lost acknowledgement after durable commit")

    with monkeypatch.context() as fault:
        fault.setattr(AsyncSession, "commit", lost_ack)
        with pytest.raises(asyncio.CancelledError):
            await world.client.post("/api/v1/transfers/evaluate", json=body)
    async with world.sessions() as session:
        tx = await session.get(Transaction, uuid.UUID(body["request_id"]))
        assert tx is not None
        original_response = tx.evaluation_snapshot
        assert await session.scalar(select(func.count()).select_from(ProjectionEvent)) == 1
    assert resources.engine.graph.metrics(world.id("bob")).in_weight == 30_000
    if recovery == "restart":
        await resources.start()
    else:
        endpoint = "/ready" if recovery == "ready" else f"/api/v1/soc/graph/{world.id('bob')}"
        assert (await world.client.get(endpoint)).status_code == 200
    assert resources.engine.graph.metrics(world.id("bob")).in_weight == 31_000
    assert await resources.redis.zcard(f"bcc:vel:settled:in:{world.id('bob')}") == 1
    retry = await world.client.post("/api/v1/transfers/evaluate", json=body)
    assert retry.json() == original_response
    async with world.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(ProjectionEvent)) == 0
        assert await session.scalar(select(func.count()).select_from(Transaction)) == 1


async def test_partial_graph_projection_replays_without_double_credit(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    resources = _resources(world)
    original = resources.engine.apply_transfer

    def partial(ctx: Any) -> None:
        original(ctx)
        raise RuntimeError("fault after graph projection")

    body = _normal_request(world)
    with monkeypatch.context() as fault:
        fault.setattr(resources.engine, "apply_transfer", partial)
        with pytest.raises(RuntimeError, match="fault after graph"):
            await world.client.post("/api/v1/transfers/evaluate", json=body)
    assert resources.engine.graph.metrics(world.id("bob")).in_weight == 31_000
    retry = await world.client.post("/api/v1/transfers/evaluate", json=body)
    assert retry.status_code == 200
    assert resources.engine.graph.metrics(world.id("bob")).in_weight == 31_000
    async with world.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(ProjectionEvent)) == 0


async def test_redis_loss_rebuilds_attempts_and_settlements_before_ready(world: World) -> None:
    resources = _resources(world)
    approved = await world.evaluate("alice", "bob", 1000)
    held = await world.evaluate("victim", "scammer", 900_000, context={"active_call": True})
    assert approved["status"] == "approved"
    assert held["status"] == "cooling_off"
    await resources.redis.flushdb()
    assert (await world.client.get("/ready")).status_code == 200
    assert await resources.redis.zcard(f"bcc:vel:settled:in:{world.id('bob')}") == 1
    assert await resources.redis.zcard(f"bcc:vel:out:{world.id('victim')}") == 1
    assert await resources.redis.zcard(f"bcc:vel:settled:out:{world.id('victim')}") == 0
    assert resources.engine.graph.metrics(world.id("bob")).in_weight == 31_000


async def test_pending_projection_failure_fails_readiness_and_new_scoring_closed(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    resources = _resources(world)
    body = _normal_request(world)

    async def unavailable(**kwargs: Any) -> None:
        raise RedisConnectionError("injected Redis write outage")

    with monkeypatch.context() as fault:
        fault.setattr(resources.engine.velocity, "record_settled", unavailable)
        with pytest.raises(RedisConnectionError):
            await world.client.post("/api/v1/transfers/evaluate", json=body)
        assert (await world.client.get("/ready")).status_code == 503
        with pytest.raises(RedisConnectionError):
            await world.client.post("/api/v1/transfers/evaluate", json=_normal_request(world))
        async with world.sessions() as session:
            assert await session.scalar(select(func.count()).select_from(Transaction)) == 1
            assert await session.scalar(select(func.count()).select_from(ProjectionEvent)) == 1
    assert (await world.client.get("/ready")).status_code == 200
    assert resources.engine.graph.metrics(world.id("bob")).in_weight == 31_000
    assert await resources.redis.zcard(f"bcc:vel:settled:in:{world.id('bob')}") == 1


async def test_abandon_wins_race_and_late_evaluation_cannot_execute(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    body = _normal_request(world)
    written, resume = asyncio.Event(), asyncio.Event()
    original = AsyncSession.commit

    async def pause_tombstone(session: AsyncSession) -> None:
        if any(isinstance(row, AbandonedRequest) for row in session.new):
            await session.flush()
            written.set()
            await resume.wait()
        await original(session)

    monkeypatch.setattr(AsyncSession, "commit", pause_tombstone)
    path = f"/api/v1/transfers/requests/{body['request_id']}/abandon"
    abandon = asyncio.create_task(world.client.post(path))
    await asyncio.wait_for(written.wait(), 5)
    late = asyncio.create_task(world.client.post("/api/v1/transfers/evaluate", json=body))
    await asyncio.sleep(0.02)
    resume.set()
    cancelled, response = await asyncio.gather(abandon, late)
    assert cancelled.json()["status"] == "abandoned"
    assert response.status_code == 409
    assert (await world.client.post(path)).json()["status"] == "abandoned"
    async with world.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Transaction)) == 0
    assert await _resources(world).redis.zcard(f"bcc:vel:out:{world.id('alice')}") == 0


async def test_evaluation_wins_race_abandon_returns_authoritative_decision(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    body = _normal_request(world)
    entered, resume = asyncio.Event(), asyncio.Event()
    original = transfers.TransferService._evaluate

    async def paused(service: transfers.TransferService, *args: Any, **kwargs: Any) -> Any:
        entered.set()
        await resume.wait()
        return await original(service, *args, **kwargs)

    monkeypatch.setattr(transfers.TransferService, "_evaluate", paused)
    evaluate = asyncio.create_task(world.client.post("/api/v1/transfers/evaluate", json=body))
    await asyncio.wait_for(entered.wait(), 5)
    abandon = asyncio.create_task(
        world.client.post(f"/api/v1/transfers/requests/{body['request_id']}/abandon")
    )
    await asyncio.sleep(0.02)
    resume.set()
    evaluated, result = await asyncio.gather(evaluate, abandon)
    assert evaluated.json()["status"] == "approved"
    assert result.json()["status"] == "processed"
    assert result.json()["evaluation"]["transaction_id"] == body["request_id"]
    assert result.json()["evaluation"]["status"] == "approved"
    async with world.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(AbandonedRequest)) == 0
        assert await session.scalar(select(func.count()).select_from(Transaction)) == 1

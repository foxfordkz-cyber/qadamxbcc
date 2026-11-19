"""Persisted recovery and no-execution actions survive scoring dependency failures."""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Literal, cast

import pytest
from fastapi import FastAPI
from pydantic import SecretStr
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import func, select

from app.core.resources import Resources
from app.models import (
    AbandonedRequest,
    GraphEdge,
    ProjectionEvent,
    RiskEvent,
    Transaction,
    TransactionStatus,
)
from tests.test_api import API, CLEAN, World
from tests.test_api import world as world
from tests.test_service_boundaries import SOC_KEY, TRANSFER_KEY

Failure = Literal["redis", "projection"]


def _app(world: World) -> FastAPI:
    return cast(FastAPI, cast(Any, world.client._transport).app)


def _resources(world: World) -> Resources:
    return cast(Resources, _app(world).state.resources)


def _normal_request(world: World, identity: str) -> dict[str, str]:
    return {
        "request_id": identity,
        "sender_id": world.id("alice"),
        "recipient_id": world.id("bob"),
        "amount": "1000",
    }


@asynccontextmanager
async def failed_dependency(
    world: World, monkeypatch: pytest.MonkeyPatch, failure: Failure
) -> AsyncIterator[None]:
    resources = _resources(world)

    async def unavailable(*args: Any, **kwargs: Any) -> Any:
        raise RedisConnectionError("injected scoring dependency failure")

    with monkeypatch.context() as fault:
        if failure == "redis":
            # Fail all Redis commands/pipelines at connection acquisition, not only
            # one coordinator method; HTTP middleware and authentication still run.
            fault.setattr(resources.redis.connection_pool, "get_connection", unavailable)
        else:
            fault.setattr(resources.engine.velocity, "record_settled", unavailable)
            # Leave a real committed approval in the outbox with delivery incomplete.
            with pytest.raises(RedisConnectionError):
                await world.client.post(
                    f"{API}/transfers/evaluate",
                    json=_normal_request(world, str(uuid.uuid4())),
                )
        yield


@pytest.mark.parametrize("failure", ["redis", "projection"])
async def test_saved_reads_and_cancellation_survive_dependency_failure(
    world: World, monkeypatch: pytest.MonkeyPatch, failure: Failure
) -> None:
    held = await world.evaluate(
        "victim", "scammer", 900_000, context={"active_call": True, "from_deposit": True}
    )
    waiting = await world.evaluate(
        "dana", "scammer", 900_000, context={"active_call": True, "from_deposit": True}
    )
    assert held["status"] == waiting["status"] == "cooling_off"
    approved = await world.evaluate("alice", "bob", 1000)
    assert approved["status"] == "approved"
    await world.expire_hold(waiting["transaction_id"])
    path = f"{API}/transfers/{held['transaction_id']}"
    new_request = _normal_request(world, str(uuid.uuid4()))

    async with failed_dependency(world, monkeypatch, failure):
        detail = await world.client.get(path)
        assert detail.status_code == 200
        assert detail.json()["status"] == "cooling_off"
        assert detail.json()["ml_score"] == held["ml_score"]
        cancelled = await world.client.post(f"{path}/cancel", json={})
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"
        repeated = await world.client.post(f"{path}/cancel", json={})
        assert repeated.status_code == 200
        assert repeated.json()["resolved_at"] == cancelled.json()["resolved_at"]
        assert (await world.client.get(path)).json()["status"] == "cancelled"
        assert (
            await world.client.post(f"{API}/transfers/{approved['transaction_id']}/cancel", json={})
        ).status_code == 409

        # SQL recovery does not weaken fail-closed financial/scoring boundaries.
        assert (await world.client.get("/ready")).status_code == 503
        with pytest.raises(RedisConnectionError):
            await world.client.post(f"{API}/transfers/evaluate", json=new_request)
        with pytest.raises(RedisConnectionError):
            await world.client.post(
                f"{API}/transfers/{waiting['transaction_id']}/resolve-cooling",
                json={"answers": CLEAN},
            )
        async with world.sessions() as session:
            assert await session.get(Transaction, uuid.UUID(new_request["request_id"])) is None
            still_held = await session.get(Transaction, uuid.UUID(waiting["transaction_id"]))
            assert still_held is not None
            assert still_held.status is TransactionStatus.COOLING_OFF
            assert still_held.verification_answers is None
            assert await session.scalar(select(func.count()).select_from(ProjectionEvent)) == (
                1 if failure == "projection" else 0
            )

    assert (await world.client.get("/ready")).status_code == 200
    assert (await world.client.get(path)).json()["status"] == "cancelled"
    assert (
        await world.client.post(f"{path}/resolve-cooling", json={"answers": CLEAN})
    ).status_code == 409
    async with world.sessions() as session:
        cancellations = await session.scalar(
            select(func.count())
            .select_from(RiskEvent)
            .where(
                RiskEvent.transaction_id == uuid.UUID(held["transaction_id"]),
                RiskEvent.rule_code == "CUSTOMER_CANCELLED",
            )
        )
        assert cancellations == 1
        assert (
            await session.scalar(
                select(func.count())
                .select_from(GraphEdge)
                .where(GraphEdge.source_id.in_((world.acc["victim"].id, world.acc["dana"].id)))
            )
            == 0
        )
    assert await _resources(world).redis.zcard(f"bcc:vel:settled:out:{world.id('victim')}") == 0


@pytest.mark.parametrize("failure", ["redis", "projection"])
async def test_abandon_during_dependency_failure_prevents_late_execution(
    world: World, monkeypatch: pytest.MonkeyPatch, failure: Failure
) -> None:
    held = await world.evaluate(
        "victim", "scammer", 900_000, context={"active_call": True, "from_deposit": True}
    )
    identity = str(uuid.uuid4())
    request = _normal_request(world, identity)
    abandon_path = f"{API}/transfers/requests/{identity}/abandon"

    async with failed_dependency(world, monkeypatch, failure):
        for _ in range(2):
            abandoned = await world.client.post(abandon_path, json={})
            assert abandoned.status_code == 200
            assert abandoned.json()["status"] == "abandoned"
            assert abandoned.json()["evaluation"] is None
        processed = await world.client.post(
            f"{API}/transfers/requests/{held['transaction_id']}/abandon", json={}
        )
        assert processed.status_code == 200
        assert processed.json()["status"] == "processed"
        assert processed.json()["evaluation"]["status"] == "cooling_off"
        assert (
            await world.client.post(f"{API}/transfers/{held['transaction_id']}/cancel", json={})
        ).status_code == 200
        processed_again = await world.client.post(
            f"{API}/transfers/requests/{held['transaction_id']}/abandon", json={}
        )
        assert processed_again.json()["evaluation"]["status"] == "cancelled"
        async with world.sessions() as session:
            assert await session.get(AbandonedRequest, uuid.UUID(identity)) is not None
            assert await session.get(Transaction, uuid.UUID(identity)) is None
            assert await session.get(AbandonedRequest, uuid.UUID(held["transaction_id"])) is None

    assert (await world.client.get("/ready")).status_code == 200
    rejected = await world.client.post(f"{API}/transfers/evaluate", json=request)
    assert rejected.status_code == 409
    assert (await world.client.post(abandon_path, json={})).json()["status"] == "abandoned"
    async with world.sessions() as session:
        assert await session.get(Transaction, uuid.UUID(identity)) is None
        assert await session.scalar(select(func.count()).select_from(AbandonedRequest)) == 1


async def test_dependency_failure_does_not_bypass_service_authorization(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    held = await world.evaluate("victim", "scammer", 900_000, context={"active_call": True})
    settings = _app(world).state.settings
    settings.api_key = SecretStr(TRANSFER_KEY)
    settings.soc_api_key = SecretStr(SOC_KEY)
    path = f"{API}/transfers/{held['transaction_id']}"
    unknown_id = uuid.uuid4()
    async with failed_dependency(world, monkeypatch, "redis"):
        for headers in ({}, {"X-BCC-API-Key": SOC_KEY}, {"X-BCC-SOC-Key": SOC_KEY}):
            assert (await world.client.get(path, headers=headers)).status_code == 401
            assert (
                await world.client.post(f"{path}/cancel", json={}, headers=headers)
            ).status_code == 401
            assert (
                await world.client.post(
                    f"{API}/transfers/requests/{unknown_id}/abandon", json={}, headers=headers
                )
            ).status_code == 401
        async with world.sessions() as session:
            unchanged = await session.get(Transaction, uuid.UUID(held["transaction_id"]))
            assert unchanged is not None
            assert unchanged.status is TransactionStatus.COOLING_OFF
            assert await session.get(AbandonedRequest, unknown_id) is None
        allowed = {"X-BCC-API-Key": TRANSFER_KEY}
        assert (await world.client.get(path, headers=allowed)).status_code == 200
        assert (
            await world.client.post(f"{path}/cancel", json={}, headers=allowed)
        ).status_code == 200
        assert (
            await world.client.post(
                f"{API}/transfers/requests/{unknown_id}/abandon", json={}, headers=allowed
            )
        ).status_code == 200

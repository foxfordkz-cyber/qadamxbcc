"""The SOC trap network is durable, auditable and shared across scoring workers."""

import uuid
from typing import Any, cast

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.core.config import Settings
from app.core.resources import Resources
from app.main import create_app
from app.models import Account, GraphEdge, RecipientFlagAudit
from app.services.graph import GraphStore
from tests.test_api import API, DAY, World
from tests.test_api import world as world
from tests.test_service_boundaries import SOC_KEY, TRANSFER_KEY, pilot


def resources(world: World) -> Resources:
    return cast(Resources, cast(Any, world.client._transport).app.state.resources)


def flag_path(world: World, name: str = "bob") -> str:
    return f"{API}/soc/recipients/{world.id(name)}/flag"


def command(flagged: bool, version: int) -> dict[str, Any]:
    return {
        "flagged": flagged,
        "note": "Synthetic SOC review",
        "request_id": str(uuid.uuid4()),
        "expected_version": version,
    }


async def test_flag_blocks_known_low_amount_and_other_senders_then_unflag(world: World) -> None:
    initial = await world.client.get(flag_path(world))
    assert initial.json()["flagged"] is False
    assert initial.json()["version"] == 0
    applied = await world.client.post(flag_path(world), json=command(True, 0))
    assert applied.status_code == 200
    assert applied.json()["previous_flagged"] is False
    assert applied.json()["updated_at"].endswith("Z")
    assert applied.headers["Cache-Control"] == "no-store"
    for sender in ("alice", "dana"):
        decision = await world.evaluate(sender, "bob", 1, occurred_at=DAY.isoformat())
        assert decision["status"] == "blocked"
        assert decision["risk_score"] >= 75
        reason = next(r for r in decision["reasons"] if r["code"] == "RECIPIENT_FLAGGED")
        assert reason["reason_kk"]
        assert reason["reason_ru"]
        assert reason["layer"] == "graph"
    async with world.sessions() as session:
        edge = await session.scalar(select(GraphEdge))
        assert edge is not None
        assert edge.weight == 30000, "Flagging must not settle a blocked transfer"
    await resources(world).start()
    assert resources(world).engine.graph.metrics(world.id("bob")).flagged
    assert (await world.client.get(flag_path(world))).json()["flagged"]
    assert (await world.client.post(flag_path(world), json=command(False, 1))).status_code == 200
    clear = await world.evaluate("alice", "bob", 1, occurred_at=DAY.isoformat())
    assert clear["status"] == "approved"
    assert "RECIPIENT_FLAGGED" not in {r["code"] for r in clear["reasons"]}


async def test_flag_audit_exact_retry_does_not_undo_newer_unflag(world: World) -> None:
    body = command(True, 0)
    first = await world.client.post(flag_path(world), json=body)
    removed = await world.client.post(flag_path(world), json=command(False, 1))
    assert removed.json()["version"] == 2
    replay = await world.client.post(flag_path(world), json=body)
    assert replay.json() == first.json()
    latest = (await world.client.get(flag_path(world))).json()
    assert latest["flagged"] is False
    assert latest["updated_at"].endswith("Z")
    assert replay.json()["updated_at"].endswith("Z")
    assert not resources(world).engine.graph.metrics(world.id("bob")).flagged
    changed = await world.client.post(flag_path(world), json={**body, "flagged": False})
    assert changed.status_code == 409
    assert changed.json()["detail"] == "flag_idempotency_conflict"
    stale = await world.client.post(flag_path(world), json=command(True, 0))
    assert stale.status_code == 409
    assert stale.json()["detail"] == "flag_version_conflict"
    async with world.sessions() as session:
        audit = list(
            await session.scalars(select(RecipientFlagAudit).order_by(RecipientFlagAudit.version))
        )
        assert len(audit) == 2
        assert [(a.previous_flagged, a.flagged) for a in audit] == [(False, True), (True, False)]
        assert all(a.actor == "local_demo_soc" and a.note == body["note"] for a in audit)
        assert all(a.created_at.tzinfo is not None for a in audit)


async def test_flag_refreshes_other_worker_scoring_and_neighbour_graph(world: World) -> None:
    other = Resources.build(
        Settings(), session_factory=world.sessions, redis=resources(world).redis
    )
    await other.start()
    app = create_app(Settings(), other)
    app.state.resources = other
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert not other.engine.graph.metrics(world.id("bob")).flagged
        assert (await world.client.post(flag_path(world), json=command(True, 0))).status_code == 200
        # The requested center is Alice; Bob's neighbour flag must still refresh.
        graph = (await client.get(f"{API}/soc/graph/{world.id('alice')}")).json()
        assert next(n["data"]["flagged"] for n in graph["nodes"] if n["id"] == world.id("bob"))
        result = await client.post(
            f"{API}/transfers/evaluate",
            json={
                "sender_id": world.id("dana"),
                "recipient_id": world.id("bob"),
                "amount": "1",
            },
        )
        assert result.json()["status"] == "blocked"
        assert "RECIPIENT_FLAGGED" in {r["code"] for r in result.json()["reasons"]}
        assert (
            await world.client.post(flag_path(world), json=command(False, 1))
        ).status_code == 200
        graph = (await client.get(f"{API}/soc/graph/{world.id('alice')}")).json()
        assert not next(n["data"]["flagged"] for n in graph["nodes"] if n["id"] == world.id("bob"))


@pytest.mark.parametrize("flagged", [True, False])
async def test_locked_db_flag_survives_graph_replacement_during_redis_await(
    world: World,
    monkeypatch: pytest.MonkeyPatch,
    flagged: bool,
) -> None:
    engine = resources(world).engine
    await world.client.post(flag_path(world), json=command(flagged, 0))
    stale = GraphStore()
    stale.add_transfer(world.id("alice"), world.id("bob"), 30000)
    stale.set_flagged(world.id("bob"), not flagged)
    original = engine.velocity.record_and_snapshot

    async def replaced(*args: Any, **kwargs: Any) -> Any:
        snapshot = await original(*args, **kwargs)
        # A rebuilding worker publishes its older graph after the transfer has
        # read the latest authoritative account state under a row lock.
        engine.graph = stale
        return snapshot

    monkeypatch.setattr(engine.velocity, "record_and_snapshot", replaced)
    decision = await world.evaluate("alice", "bob", 1, occurred_at=DAY.isoformat())
    assert decision["recipient_graph"]["flagged"] is flagged
    assert ("RECIPIENT_FLAGGED" in {r["code"] for r in decision["reasons"]}) is flagged
    assert decision["status"] == ("blocked" if flagged else "approved")


async def test_pilot_flag_endpoint_requires_soc_service_and_audits_service_identity(
    world: World,
) -> None:
    app: FastAPI = create_app(pilot())
    app.state.resources = resources(world)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for headers in ({}, {"X-BCC-API-Key": TRANSFER_KEY}, {"X-BCC-SOC-Key": TRANSFER_KEY}):
            assert (await client.get(flag_path(world), headers=headers)).status_code == 401
            assert (
                await client.post(flag_path(world), headers=headers, json=command(True, 0))
            ).status_code == 401
        response = await client.post(
            flag_path(world), headers={"X-BCC-SOC-Key": SOC_KEY}, json=command(True, 0)
        )
        assert response.status_code == 200
        assert response.json()["actor"].startswith("soc_service:")
        assert SOC_KEY not in response.text
    async with world.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(RecipientFlagAudit)) == 1


@pytest.mark.parametrize("note", ["", "   ", "x" * 201, "invalid\ncontrol"])
async def test_flag_requires_bounded_nonempty_reason(world: World, note: str) -> None:
    response = await world.client.post(flag_path(world), json={"flagged": True, "note": note})
    assert response.status_code == 422
    async with world.sessions() as session:
        account = await session.get(Account, world.acc["bob"].id)
        assert account is not None
        assert not account.is_flagged
        assert await session.scalar(select(func.count()).select_from(RecipientFlagAudit)) == 0


async def test_missing_flag_account_returns_404(world: World) -> None:
    path = f"{API}/soc/recipients/{uuid.uuid4()}/flag"
    assert (await world.client.get(path)).status_code == 404
    assert (await world.client.post(path, json=command(True, 0))).status_code == 404


def test_old_graph_snapshot_cannot_overwrite_newer_flag_revision() -> None:
    graph = GraphStore()
    graph.add_account("account", flagged=True, flag_version=1)
    graph.set_flagged("account", False, version=2)
    graph.add_account("account", flagged=True, flag_version=1)
    assert not graph.metrics("account").flagged


async def test_alerts_filter_applies_before_pagination_and_leaves_global_stats(
    world: World,
) -> None:
    await world.evaluate("alice", "bob", 1, occurred_at=DAY.isoformat())
    await world.evaluate(
        "victim", "scammer", 900_000, context={"active_call": True, "from_deposit": True}
    )
    await world.client.post(flag_path(world), json=command(True, 0))
    await world.evaluate("dana", "bob", 1)
    for offset in (0, 1):
        page = await world.client.get(
            f"{API}/soc/feed", params={"alerts_only": "true", "limit": 1, "offset": offset}
        )
        assert page.status_code == 200
        value = page.json()
        assert value["items"][0]["status"] in {"cooling_off", "blocked"}
        assert value["pagination"]["total_filtered"] == 2
        assert value["pagination"]["has_more"] is (offset == 0)
        assert value["stats"]["total"] == 3
    empty = await world.client.get(
        f"{API}/soc/feed", params={"alerts_only": "true", "status": "approved"}
    )
    assert empty.json()["pagination"]["total_filtered"] == 0

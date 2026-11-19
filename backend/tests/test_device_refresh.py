"""Current registrations and retained device evidence agree before/after rebuilds."""

import uuid
from decimal import Decimal
from typing import Any, cast

import pytest
from sqlalchemy import func, insert, select

from app.core.kz import make_kz_iban
from app.core.resources import Resources
from app.models import Account, EdgeType, GraphEdge, RiskEvent, Transaction, TransactionStatus
from app.services.graph import MAX_GRAPH_NEIGHBOURS, GraphStore
from app.services.transfers import hydrate_graph, register_account
from tests.clock import pin_server_clock
from tests.test_api import API, CLEAN, DAY, World
from tests.test_api import world as world


def resources(world: World) -> Resources:
    return cast(Resources, cast(Any, world.client._transport).app.state.resources)


@pytest.mark.parametrize("observed", [False, True])
def test_registration_replacement_keeps_only_independent_device_history(observed: bool) -> None:
    graph = GraphStore()
    graph.add_account("a", device_id="shared")
    graph.add_account("b", device_id="shared")
    if observed:
        graph.link_device("b", "shared")
    graph.add_account("b", device_id="replacement")
    assert graph.device_peers("a") == ({"b"} if observed else set())
    assert graph.accounts_on_device("replacement") == {"b"}
    graph.add_account("b", device_id="")
    assert graph.accounts_on_device("replacement") == set()
    assert graph.device_peers("a") == ({"b"} if observed else set())


def test_repeated_registration_and_two_account_moves_do_not_leave_extra_peers() -> None:
    graph = GraphStore()
    for account in ("a", "b"):
        graph.add_account(account, device_id="old")
        graph.add_account(account, device_id="old")
    assert graph.metrics("a").shared_device_accounts == 1
    for account in ("a", "b"):
        graph.add_account(account, device_id="new")
    assert graph.accounts_on_device("old") == set()
    assert graph.accounts_on_device("new") == {"a", "b"}
    graph.add_account("a", device_id="")
    assert graph.device_peers("b") == set()


def test_device_evidence_recorded_before_registration_remains_independent() -> None:
    graph = GraphStore()
    for account in ("a", "b"):
        graph.link_device(account, "observed")
        graph.add_account(account, device_id="observed")
        graph.add_account(account, device_id=f"current-{account}")
    assert graph.accounts_on_device("observed") == {"a", "b"}
    assert graph.metrics("a").shared_device_accounts == 1
    graph.add_account("b", device_id="")
    assert graph.device_peers("a") == {"b"}


async def test_demo_observed_history_survives_replacement_but_pilot_rebuild_excludes_it(
    world: World,
) -> None:
    res = resources(world)
    device = "synthetic-observed-tablet"
    for name in ("victim", "feeder0"):
        await world.evaluate(name, "scammer", 1000, device_id=device)
    async with world.sessions() as session:
        for name in ("victim", "feeder0"):
            account = await session.get(Account, world.acc[name].id)
            assert account is not None
            account.device_id = f"replacement-{name}"
            register_account(res.engine.graph, account)
        await session.commit()
    expected = {world.id("victim"), world.id("feeder0")}
    assert res.engine.graph.accounts_on_device(device) == expected
    await res.start()
    assert res.engine.graph.accounts_on_device(device) == expected
    res.engine.allow_demo_overrides = False
    await res.start()
    assert res.engine.graph.accounts_on_device(device) == set()


async def test_moved_away_nonparty_peers_match_rebuilt_pilot_graph(world: World) -> None:
    res = resources(world)
    res.engine.allow_demo_overrides = False
    device = world.acc["scammer"].device_id
    async with world.sessions() as session:
        for name in ("feeder0", "feeder1"):
            peer = await session.get(Account, world.acc[name].id)
            assert peer is not None
            peer.device_id = device
        await session.commit()
    first = await world.evaluate("victim", "scammer", 1000)
    assert first["recipient_graph"]["shared_device_accounts"] == 2
    async with world.sessions() as session:
        for name in ("feeder0", "feeder1"):
            peer = await session.get(Account, world.acc[name].id)
            assert peer is not None
            peer.device_id = f"replacement-{name}"
        await session.commit()
    current = await world.evaluate("victim", "scammer", 1000)
    before_restart = current["recipient_graph"]["shared_device_accounts"]
    await res.start()
    assert before_restart == res.engine.graph.metrics(world.id("scammer")).shared_device_accounts
    assert before_restart == 0


async def test_persisted_shared_edge_survives_registration_replacement(world: World) -> None:
    graph = GraphStore()
    async with world.sessions() as session:
        session.add(
            GraphEdge(
                source_id=world.acc["dana"].id,
                target_id=world.acc["scammer"].id,
                edge_type=EdgeType.SHARED_DEVICE,
                weight=0,
                tx_count=0,
                last_seen_at=DAY,
            )
        )
        await session.commit()
        await hydrate_graph(session, graph, include_observed_devices=False)
        for name in ("dana", "scammer"):
            account = await session.get(Account, world.acc[name].id)
            assert account is not None
            account.device_id = f"replacement-{name}"
            register_account(graph, account)
        await session.commit()
        fresh = GraphStore()
        await hydrate_graph(session, fresh, include_observed_devices=False)
    assert graph.device_peers(world.id("dana")) == {world.id("scammer")}
    assert graph.device_peers(world.id("dana")) == fresh.device_peers(world.id("dana"))


async def test_release_refreshes_current_recipient_device_peers(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    pin_server_clock(monkeypatch, DAY)
    held = await world.evaluate("victim", "scammer", 900_000, context={"active_call": True})
    assert held["status"] == "cooling_off"
    async with world.sessions() as session:
        for name in ("feeder0", "feeder1"):
            peer = await session.get(Account, world.acc[name].id)
            assert peer is not None
            peer.device_id = world.acc["scammer"].device_id
        await session.commit()
    await world.expire_hold(held["transaction_id"])
    response = await world.client.post(
        f"{API}/transfers/{held['transaction_id']}/resolve-cooling", json={"answers": CLEAN}
    )
    assert response.status_code == 200
    audit = next(r for r in response.json()["reasons"] if r["code"] == "RELEASE_REVALIDATED")
    assert audit["evidence"]["recipient_graph"]["shared_device_accounts"] == 2
    assert "RECIPIENT_SHARED_DEVICE" in {r["code"] for r in audit["evidence"]["reasons"]}
    # Shared registration alone remains advisory; no change to the risk policy.
    assert response.json()["status"] == "approved"


async def test_pilot_release_refreshes_original_device_roster_without_linking_sender(
    world: World,
) -> None:
    res = resources(world)
    res.engine.allow_demo_overrides = False
    held = await world.evaluate("victim", "scammer", 900_000, context={"active_call": True})
    original_device = world.acc["victim"].device_id
    async with world.sessions() as session:
        sender = await session.get(Account, world.acc["victim"].id)
        assert sender is not None
        sender.device_id = "replacement-sender-device"
        for name in ("feeder0", "feeder1"):
            peer = await session.get(Account, world.acc[name].id)
            assert peer is not None
            peer.device_id = original_device
        await session.commit()
    await world.expire_hold(held["transaction_id"])
    response = await world.client.post(
        f"{API}/transfers/{held['transaction_id']}/resolve-cooling", json={"answers": CLEAN}
    )
    assert response.status_code == 200
    audit = next(r for r in response.json()["reasons"] if r["code"] == "RELEASE_REVALIDATED")
    shared = next(r for r in audit["evidence"]["reasons"] if r["code"] == "SENDER_DEVICE_SHARED")
    assert shared["evidence"]["n"] == 2
    assert res.engine.graph.accounts_on_device(original_device) == {
        world.id("feeder0"),
        world.id("feeder1"),
    }


@pytest.mark.parametrize("empty_device", [False, True])
async def test_release_device_refresh_has_bounded_complete_clusters(
    world: World, empty_device: bool
) -> None:
    res = resources(world)
    held = await world.evaluate("victim", "scammer", 900_000, context={"active_call": True})
    graph_nodes = res.engine.graph.node_count
    device = "" if empty_device else world.acc["scammer"].device_id
    async with world.sessions() as session:
        if empty_device:
            recipient = await session.get(Account, world.acc["scammer"].id)
            assert recipient is not None
            recipient.device_id = ""
        await session.execute(
            insert(Account),
            [
                {
                    "id": uuid.uuid4(),
                    "iin": f"900102{index:06d}",
                    "iban": make_kz_iban(f"{index + 1000:013d}"),
                    "phone": f"+7702{index:07d}",
                    "full_name": f"Synthetic peer {index}",
                    "device_id": device,
                    "avg_tx_amount": Decimal("40000"),
                }
                for index in range(MAX_GRAPH_NEIGHBOURS)
            ],
        )
        await session.commit()
    if not empty_device:
        new_id = uuid.uuid4()
        rejected = await world.client.post(
            f"{API}/transfers/evaluate",
            json={
                "request_id": str(new_id),
                "sender_id": world.id("dana"),
                "recipient_id": world.id("scammer"),
                "amount": "1000",
            },
        )
        assert rejected.status_code == 503
        async with world.sessions() as session:
            assert await session.get(Transaction, new_id) is None
    await world.expire_hold(held["transaction_id"])
    response = await world.client.post(
        f"{API}/transfers/{held['transaction_id']}/resolve-cooling", json={"answers": CLEAN}
    )
    if empty_device:
        assert response.status_code == 200
        assert res.engine.graph.accounts_on_device("") == set()
        assert res.engine.graph.node_count == graph_nodes
    else:
        assert response.status_code == 503
        assert res.engine.graph.node_count == graph_nodes
        async with world.sessions() as session:
            tx = await session.get(Transaction, uuid.UUID(held["transaction_id"]))
            assert tx is not None
            assert tx.status is TransactionStatus.COOLING_OFF
            assert tx.verification_answers is None
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(RiskEvent)
                    .where(
                        RiskEvent.transaction_id == tx.id,
                        RiskEvent.rule_code == "RELEASE_REVALIDATED",
                    )
                )
                == 0
            )

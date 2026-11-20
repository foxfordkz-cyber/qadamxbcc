"""A new request ID cannot erase an unresolved sender review window."""

import uuid
from datetime import timedelta
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.core.config import Settings
from app.core.resources import Resources
from app.main import create_app
from app.models import GraphEdge, Transaction
from app.services.antifraud import ACTIVE_HOLD_RULE
from tests.clock import pin_server_clock
from tests.test_api import API, CLEAN, DAY, World
from tests.test_api import world as world
from tests.test_recipient_flags import command, flag_path, resources


@pytest.fixture(autouse=True)
def server_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    pin_server_clock(monkeypatch, DAY)


async def original_hold(world: World, recipient: str = "scammer") -> dict[str, Any]:
    result = await world.evaluate(
        "alice", recipient, 900_000, context={"active_call": True, "from_deposit": True}
    )
    assert isinstance(result, dict)
    return result


def guard_reason(decision: dict[str, Any]) -> dict[str, Any]:
    return next(reason for reason in decision["reasons"] if reason["code"] == ACTIVE_HOLD_RULE)


@pytest.mark.parametrize("recipient", ["scammer", "dana"])
async def test_cleared_context_and_new_request_id_keep_original_pause(
    world: World, recipient: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = await original_hold(world)
    assert original["status"] == "cooling_off"
    pin_server_clock(monkeypatch, DAY + timedelta(minutes=14))
    body = {
        "request_id": str(uuid.uuid4()),
        "sender_id": world.id("alice"),
        "recipient_id": world.id(recipient),
        "amount": "1",
        # Browser time and familiarity overrides cannot erase SQL evidence.
        "occurred_at": (DAY - timedelta(days=2)).isoformat(),
        "context": {"active_call": False, "from_deposit": False, "is_new_recipient": False},
    }
    first = await world.client.post(f"{API}/transfers/evaluate", json=body)
    decision = first.json()
    assert first.status_code == 200
    assert decision["status"] == "cooling_off"
    assert decision["risk_score"] == 40
    assert decision["cooling_off_until"] == original["cooling_off_until"]
    reason = guard_reason(decision)
    assert reason["layer"] == "behavioral"
    assert reason["score_delta"] == 40
    assert reason["evidence"]["source"] == "server"
    assert reason["evidence"]["original_transaction_id"] == original["transaction_id"]
    assert reason["evidence"]["recipient_changed"] is (recipient != "scammer")
    assert reason["reason_kk"]
    assert reason["reason_ru"]
    assert "15" not in decision["headline_ru"]
    detail = await world.client.get(f"{API}/transfers/{decision['transaction_id']}")
    assert detail.json()["headline_ru"] == decision["headline_ru"]
    assert detail.json()["headline_kk"] == decision["headline_kk"]
    # A later cancellation cannot change an exact replay's original decision.
    await world.client.post(f"{API}/transfers/{original['transaction_id']}/cancel")
    replay = await world.client.post(f"{API}/transfers/evaluate", json=body)
    assert replay.json() == decision
    async with world.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Transaction)) == 2
        assert await session.scalar(select(func.count()).select_from(GraphEdge)) == 1


async def test_known_different_recipient_and_other_sender_still_pass(world: World) -> None:
    await original_hold(world)
    familiar = await world.evaluate("alice", "bob", 1)
    unrelated = await world.evaluate("victim", "dana", 1)
    for decision in (familiar, unrelated):
        assert decision["status"] == "approved"
        assert ACTIVE_HOLD_RULE not in {r["code"] for r in decision["reasons"]}


async def test_same_already_known_recipient_is_still_guarded(world: World) -> None:
    original = await original_hold(world, "bob")
    retry = await world.evaluate("alice", "bob", 1)
    assert retry["status"] == "cooling_off"
    assert retry["is_new_recipient"] is False
    assert guard_reason(retry)["evidence"]["original_transaction_id"] == original["transaction_id"]


@pytest.mark.parametrize(
    "ending", ["cancelled", "expired", "old_extended_deadline", "future_created_at"]
)
async def test_finished_or_expired_source_no_longer_guards(
    world: World, ending: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = await original_hold(world)
    if ending == "cancelled":
        await world.client.post(f"{API}/transfers/{original['transaction_id']}/cancel")
    elif ending == "future_created_at":
        async with world.sessions() as session:
            tx = await session.get(Transaction, uuid.UUID(original["transaction_id"]))
            assert tx is not None
            tx.created_at = DAY + timedelta(days=1)
            tx.cooling_until = DAY + timedelta(days=1, minutes=15)
            await session.commit()
    else:
        if ending == "old_extended_deadline":
            async with world.sessions() as session:
                tx = await session.get(Transaction, uuid.UUID(original["transaction_id"]))
                assert tx is not None
                tx.cooling_until = DAY + timedelta(hours=2)
                await session.commit()
        pin_server_clock(monkeypatch, DAY + timedelta(minutes=15))
    decision = await world.evaluate("alice", "dana", 1)
    assert decision["status"] == "approved"
    assert ACTIVE_HOLD_RULE not in {r["code"] for r in decision["reasons"]}


async def test_guard_descendant_cannot_anchor_another_hold(world: World) -> None:
    original = await original_hold(world)
    child = await world.evaluate("alice", "dana", 1)
    assert child["status"] == "cooling_off"
    await world.client.post(f"{API}/transfers/{original['transaction_id']}/cancel")
    # Child is still unresolved, but the original investigation was cancelled.
    later = await world.evaluate("alice", "victim", 1)
    assert later["status"] == "approved"
    assert ACTIVE_HOLD_RULE not in {r["code"] for r in later["reasons"]}


async def test_independent_new_risk_keeps_full_window_and_can_be_an_anchor(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = await original_hold(world)
    pin_server_clock(monkeypatch, DAY + timedelta(minutes=14))
    independent = await world.evaluate(
        "alice", "dana", 900_000, context={"active_call": True, "from_deposit": True}
    )
    assert independent["status"] == "cooling_off"
    assert independent["cooling_off_until"] != original["cooling_off_until"]
    assert independent["cooling_off_until"].startswith("2026-11-13T09:29:00")
    assert ACTIVE_HOLD_RULE not in {r["code"] for r in independent["reasons"]}
    pin_server_clock(monkeypatch, DAY + timedelta(minutes=16))
    retry = await world.evaluate("alice", "dana", 1)
    assert (
        guard_reason(retry)["evidence"]["original_transaction_id"] == independent["transaction_id"]
    )
    assert retry["cooling_off_until"] == independent["cooling_off_until"]


async def test_current_confirmed_flag_still_blocks_without_guard(world: World) -> None:
    await original_hold(world)
    await world.client.post(flag_path(world, "dana"), json=command(True, 0))
    decision = await world.evaluate("alice", "dana", 1)
    assert decision["status"] == "blocked"
    assert decision["cooling_off_until"] is None
    assert ACTIVE_HOLD_RULE not in {r["code"] for r in decision["reasons"]}


async def test_guard_is_durable_across_independent_worker_startup(world: World) -> None:
    original = await original_hold(world)
    other = Resources.build(
        Settings(), session_factory=world.sessions, redis=resources(world).redis
    )
    await other.start()
    app = create_app(Settings(), other)
    app.state.resources = other
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            f"{API}/transfers/evaluate",
            json={"sender_id": world.id("alice"), "recipient_id": world.id("dana"), "amount": "1"},
        )
    assert response.status_code == 200
    assert (
        guard_reason(response.json())["evidence"]["original_transaction_id"]
        == original["transaction_id"]
    )


async def test_inherited_deadline_needs_explicit_confirmation_to_settle(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    await original_hold(world)
    pin_server_clock(monkeypatch, DAY + timedelta(minutes=14))
    child = await world.evaluate("alice", "dana", 1)
    path = f"{API}/transfers/{child['transaction_id']}/resolve-cooling"
    early = await world.client.post(path, json={"answers": CLEAN})
    assert early.json()["status"] == "cooling_off"
    pin_server_clock(monkeypatch, DAY + timedelta(minutes=15))
    detail = await world.client.get(f"{API}/transfers/{child['transaction_id']}")
    assert detail.json()["status"] == "cooling_off", "Deadline expiry does not execute money"
    released = await world.client.post(path, json={"answers": CLEAN})
    assert released.json()["status"] == "approved"
    assert "Продолжается" not in released.json()["headline_ru"]

"""Real SQL ordering for sender review and concurrent cancellation."""

import asyncio
import uuid
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.resources import Resources
from app.db.locks import serialize_sender
from app.main import create_app
from app.models import Account, Transaction
from app.schemas.soc import RecipientFlagRequest, RecipientFlagResponse
from app.schemas.transfers import TransferEvaluateRequest
from app.services import transfers
from app.services.recipient_flags import set_flag
from app.services.transfers import TransferService
from app.services.velocity import SettledPayee
from tests.test_active_hold_guard import guard_reason, original_hold
from tests.test_active_hold_guard import server_clock as server_clock
from tests.test_api import API, CLEAN, World
from tests.test_api import world as world
from tests.test_postgres_concurrency import session_factory as session_factory
from tests.test_recipient_flags import resources


async def test_split_payment_boundary_is_shared_by_two_postgres_workers(world: World) -> None:
    other = Resources.build(
        Settings(), session_factory=world.sessions, redis=resources(world).redis
    )
    await other.start()
    app = create_app(Settings(), other)
    app.state.resources = other
    body = {"sender_id": world.id("alice"), "recipient_id": world.id("scammer"), "amount": "50000"}
    path = f"{API}/transfers/evaluate"
    first = await world.client.post(path, json={**body, "request_id": str(uuid.uuid4())})
    assert first.json()["status"] == "approved"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as peer:
        results = await asyncio.gather(
            world.client.post(path, json={**body, "request_id": str(uuid.uuid4())}),
            peer.post(path, json={**body, "request_id": str(uuid.uuid4())}),
        )
    decisions = [response.json() for response in results]
    assert sorted(item["status"] for item in decisions) == ["approved", "cooling_off"]
    held = next(item for item in decisions if item["status"] == "cooling_off")
    evidence = next(r["evidence"] for r in held["reasons"] if r["code"] == "SPLIT_TRANSFERS_24H")
    assert evidence["total_kzt"] == 150_000


async def test_separate_workers_serialize_first_hold_and_cleared_retry(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = Resources.build(
        Settings(), session_factory=world.sessions, redis=resources(world).redis
    )
    await other.start()
    app = create_app(Settings(), other)
    app.state.resources = other
    entered, resume = asyncio.Event(), asyncio.Event()
    engine = resources(world).engine
    evaluate = engine.evaluate

    async def paused(*args: Any, **kwargs: Any) -> Any:
        entered.set()
        await resume.wait()
        return await evaluate(*args, **kwargs)

    monkeypatch.setattr(engine, "evaluate", paused)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        initial = asyncio.create_task(original_hold(world))
        await asyncio.wait_for(entered.wait(), 5)
        retry = asyncio.create_task(
            client.post(
                f"{API}/transfers/evaluate",
                json={
                    "sender_id": world.id("alice"),
                    "recipient_id": world.id("dana"),
                    "amount": "1",
                },
            )
        )
        try:
            await asyncio.sleep(0.05)
            assert not retry.done(), "Second worker must wait for the sender's first SQL decision"
        finally:
            resume.set()
        source, response = await asyncio.wait_for(asyncio.gather(initial, retry), 10)
    assert response.status_code == 200
    child = response.json()
    assert guard_reason(child)["evidence"]["original_transaction_id"] == source["transaction_id"]
    assert child["cooling_off_until"] == source["cooling_off_until"]


async def test_cancellation_orders_after_inflight_guard_source_read(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = await original_hold(world)
    entered, resume = asyncio.Event(), asyncio.Event()
    engine = resources(world).engine
    evaluate = engine.evaluate

    async def paused(*args: Any, **kwargs: Any) -> Any:
        entered.set()
        await resume.wait()
        return await evaluate(*args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(engine, "evaluate", paused)
        retry = asyncio.create_task(world.evaluate("alice", "dana", 1))
        await asyncio.wait_for(entered.wait(), 5)
        cancel = asyncio.create_task(
            world.client.post(f"{API}/transfers/{source['transaction_id']}/cancel")
        )
        try:
            await asyncio.sleep(0.05)
            assert not cancel.done(), "Cancel cannot invalidate an already locked source snapshot"
        finally:
            resume.set()
        child, cancelled = await asyncio.wait_for(asyncio.gather(retry, cancel), 10)
    assert child["status"] == "cooling_off"
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    later = await world.evaluate("alice", "victim", 1)
    assert later["status"] == "approved", "Neither cancelled source nor child may extend the guard"


async def test_retry_resolve_and_queued_soc_writer_do_not_form_a_lock_cycle(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = await original_hold(world)
    account_locked, child_resume = asyncio.Event(), asyncio.Event()
    resolve_requested, source_locked, resolve_resume = (
        asyncio.Event(),
        asyncio.Event(),
        asyncio.Event(),
    )
    original_recipient = TransferService._resolve_recipient
    original_load = TransferService._load
    original_sender_lock = serialize_sender

    async def paused_recipient(
        service: TransferService, request: TransferEvaluateRequest, sender: Account
    ) -> tuple[Account, bool, SettledPayee]:
        result = await original_recipient(service, request, sender)
        account_locked.set()
        await child_resume.wait()
        return result

    async def paused_source(
        service: TransferService, identity: uuid.UUID, *, locked: bool = False
    ) -> Transaction:
        value = await original_load(service, identity, locked=locked)
        if locked:
            source_locked.set()
            await resolve_resume.wait()
        return value

    async def watched_sender_lock(session: AsyncSession, identity: uuid.UUID) -> None:
        resolve_requested.set()
        await original_sender_lock(session, identity)

    label = f"bcc_hold_flag_{uuid.uuid4().hex}"

    async def flag_writer() -> RecipientFlagResponse:
        async with world.sessions() as session:
            await session.execute(
                text("SELECT set_config('application_name', :name, true)"), {"name": label}
            )
            return await set_flag(
                session,
                resources(world).engine.graph,
                world.acc["scammer"].id,
                RecipientFlagRequest(flagged=True, note="Synthetic concurrent SOC review"),
                "test_soc_service",
            )

    async def wait_for_queued_writer() -> None:
        # Observe the actual PG wait, not an assumed scheduler delay. The local
        # application_name singles out our disposable fixture's writer connection.
        while True:
            async with world.sessions() as session:
                blocked = await session.scalar(
                    text(
                        "SELECT count(*) FROM pg_stat_activity "
                        "WHERE application_name = :name AND wait_event_type = 'Lock'"
                    ),
                    {"name": label},
                )
            if blocked:
                return
            await asyncio.sleep(0.01)

    monkeypatch.setattr(TransferService, "_resolve_recipient", paused_recipient)
    monkeypatch.setattr(TransferService, "_load", paused_source)
    child = asyncio.create_task(world.evaluate("alice", "scammer", 1))
    await asyncio.wait_for(account_locked.wait(), 5)
    # The child already owns sender + recipient. Only the resolver reaches this
    # newly installed hook; it must wait for sender before locking source tx.
    monkeypatch.setattr(transfers, "serialize_sender", watched_sender_lock)
    resolve = asyncio.create_task(
        world.client.post(
            f"{API}/transfers/{source['transaction_id']}/resolve-cooling", json={"answers": CLEAN}
        )
    )
    flag = None
    try:
        await asyncio.wait_for(resolve_requested.wait(), 5)
        flag = asyncio.create_task(flag_writer())
        await asyncio.wait_for(wait_for_queued_writer(), 5)
        locked_before_child_commit = source_locked.is_set()
    finally:
        resolve_resume.set()
        child_resume.set()
        pending = [child, resolve, *([flag] if flag is not None else [])]
        outcomes = await asyncio.wait_for(asyncio.gather(*pending, return_exceptions=True), 10)
    assert not locked_before_child_commit, "Resolver must not hold source while waiting for sender"
    assert not any(isinstance(value, BaseException) for value in outcomes), outcomes
    assert flag is not None
    child_result, resolved, flagged = child.result(), resolve.result(), flag.result()
    assert child_result["status"] == "cooling_off"
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "blocked", "Resolver rechecks the newly committed SOC flag"
    assert flagged.flagged

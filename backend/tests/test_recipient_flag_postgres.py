"""Real PostgreSQL row-lock checks in the disposable bcc_audit_* schema."""

import asyncio
from typing import Any

import pytest
from sqlalchemy import func, select

from app.models import Account, RecipientFlagAudit
from tests.test_api import API, World
from tests.test_api import world as world
from tests.test_postgres_concurrency import session_factory as session_factory
from tests.test_recipient_flags import command, flag_path, resources


async def test_concurrent_flag_replay_has_one_audit_and_conflicts_serialize(world: World) -> None:
    body = command(True, 0)
    responses = await asyncio.gather(
        *(world.client.post(flag_path(world), json=body) for _ in range(8))
    )
    assert all(response.status_code == 200 for response in responses)
    assert all(response.json() == responses[0].json() for response in responses)
    changes = await asyncio.gather(
        world.client.post(flag_path(world), json=command(False, 1)),
        world.client.post(flag_path(world), json=command(True, 1)),
    )
    assert sorted(response.status_code for response in changes) == [200, 409]
    async with world.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(RecipientFlagAudit)) == 2
        account = await session.get(Account, world.acc["bob"].id)
        assert account is not None
        assert account.flag_version == 2
        assert account.is_flagged == next(
            response.json()["flagged"] for response in changes if response.status_code == 200
        )


async def test_flag_waits_for_inflight_decision_then_blocks_all_later_transfers(
    world: World,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entered, resume = asyncio.Event(), asyncio.Event()
    engine = resources(world).engine
    original = engine.evaluate

    async def paused(*args: Any, **kwargs: Any) -> Any:
        entered.set()
        await resume.wait()
        return await original(*args, **kwargs)

    with monkeypatch.context() as fault:
        fault.setattr(engine, "evaluate", paused)
        transfer = asyncio.create_task(world.evaluate("alice", "bob", 1))
        await asyncio.wait_for(entered.wait(), 5)
        flag = asyncio.create_task(world.client.post(flag_path(world), json=command(True, 0)))
        try:
            await asyncio.sleep(0.05)
            assert not flag.done(), "SOC confirmation must wait for the recipient read lock"
        finally:
            resume.set()
        decision, confirmation = await asyncio.gather(transfer, flag)
    assert decision["status"] == "approved"
    assert confirmation.status_code == 200
    later = await world.client.post(
        f"{API}/transfers/evaluate",
        json={
            "sender_id": world.id("dana"),
            "recipient_id": world.id("bob"),
            "amount": "1",
        },
    )
    assert later.json()["status"] == "blocked"

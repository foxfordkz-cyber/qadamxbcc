import asyncio
import uuid

import pytest
from sqlalchemy import func, select

from app.models import PaymentReturn, Transaction
from tests.test_api import API, DAY, World
from tests.test_api import world as world
from tests.test_linked_returns import (
    REPORT,
    RETURN,
    assert_concurrent_returns,
    payment,
    previous_debit,
)
from tests.test_postgres_concurrency import session_factory as session_factory


async def test_concurrent_linked_returns(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    await assert_concurrent_returns(world, monkeypatch)


async def test_concurrent_debits_cannot_spend_disputed_funds_twice(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = await payment(world, monkeypatch)
    await previous_debit(world, "4996000.00")
    assert (await world.client.post(f"{API}/returns/{original}", json=REPORT)).is_success
    body = {
        "sender_id": world.id("alice"),
        "recipient_id": world.id("bob"),
        "amount": "3000",
        "occurred_at": DAY.isoformat(),
    }
    replies = await asyncio.gather(
        *(
            world.client.post(
                f"{API}/transfers/evaluate", json={**body, "request_id": str(uuid.uuid4())}
            )
            for _ in range(2)
        )
    )
    assert sorted(r.status_code for r in replies) == [200, 409]
    accepted, denied = sorted(replies, key=lambda r: r.status_code)
    assert accepted.json()["status"] == "approved"
    assert denied.json()["detail"] == "disputed_amount_reserved"


async def test_return_and_report_serialize_on_same_original(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    original_id = await payment(world, monkeypatch)
    path = f"{API}/returns/{original_id}"
    results = await asyncio.gather(
        world.client.post(path, json=RETURN), world.client.post(path, json=REPORT)
    )
    assert sorted(r.status_code for r in results) == [200, 409]
    async with world.sessions() as session:
        record = await session.get(PaymentReturn, uuid.UUID(original_id))
        assert record
        assert bool(record.reported_at) != bool(record.refund_transaction_id)
        assert await session.scalar(select(func.count()).select_from(Transaction)) == (
            2 if record.refund_transaction_id else 1
        )

import asyncio
import uuid

import pytest
from sqlalchemy import func, select

from app.models import PaymentReturn, Transaction
from tests.test_api import API
from tests.test_api import World
from tests.test_api import world as world
from tests.test_linked_returns import REPORT, RETURN, assert_concurrent_returns, payment
from tests.test_postgres_concurrency import session_factory as session_factory


async def test_concurrent_linked_returns(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    await assert_concurrent_returns(world, monkeypatch)


async def test_return_and_report_serialize_on_same_original(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    original_id = await payment(world,monkeypatch)
    path = f"{API}/returns/{original_id}"
    results = await asyncio.gather(world.client.post(path,json=RETURN),world.client.post(path,json=REPORT))
    assert sorted(r.status_code for r in results) == [200,409]
    async with world.sessions() as session:
        record = await session.get(PaymentReturn,uuid.UUID(original_id))
        assert record
        assert bool(record.reported_at) != bool(record.refund_transaction_id)
        assert await session.scalar(select(func.count()).select_from(Transaction)) == (2 if record.refund_transaction_id else 1)

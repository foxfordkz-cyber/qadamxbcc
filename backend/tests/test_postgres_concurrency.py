"""Opt-in real PostgreSQL concurrency checks in a newly created, disposable schema.

Set BCC_TEST_POSTGRES_URL to a dedicated test server (never a customer database).
Each test creates and drops only its own randomly named bcc_audit_* schema.
"""

import asyncio
import os
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.base import Base
from app.db.session import build_session_factory
from app.models import AbandonedRequest, GraphEdge, ProjectionEvent, Transaction, TransactionStatus
from tests.test_api import CLEAN, World
from tests.test_api import world as world


@pytest.fixture
async def session_factory() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    url = os.environ.get("BCC_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("Set BCC_TEST_POSTGRES_URL for isolated PostgreSQL concurrency tests")
    if not url.startswith("postgresql+asyncpg://"):
        pytest.fail("BCC_TEST_POSTGRES_URL must use postgresql+asyncpg")
    schema = "bcc_audit_" + uuid.uuid4().hex
    admin = create_async_engine(url, connect_args={"timeout": 5})
    engine = create_async_engine(
        url,
        connect_args={"timeout": 5, "server_settings": {"search_path": schema}},
        pool_size=10,
        max_overflow=10,
    )
    created = False
    try:
        async with admin.begin() as connection:
            await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        created = True
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield build_session_factory(engine)
    finally:
        await engine.dispose()
        if created:
            async with admin.begin() as connection:
                await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()


async def test_postgres_concurrent_replays_and_atomic_aggregate(world: World) -> None:
    request = {
        "request_id": str(uuid.uuid4()),
        "sender_id": world.id("alice"),
        "recipient_id": world.id("bob"),
        "amount": "1000.01",
    }
    responses = await asyncio.gather(
        *(world.client.post("/api/v1/transfers/evaluate", json=request) for _ in range(12))
    )
    assert all(response.status_code == 200 for response in responses)
    assert all(response.json() == responses[0].json() for response in responses)
    assert responses[0].json()["status"] == "approved"
    additional = await asyncio.gather(
        *(
            world.client.post(
                "/api/v1/transfers/evaluate",
                json={**request, "request_id": str(uuid.uuid4())},
            )
            for _ in range(2)
        )
    )
    assert all(response.status_code == 200 for response in additional)
    assert (await world.client.get("/ready")).status_code == 200
    async with world.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Transaction)) == 3
        assert await session.scalar(select(func.count()).select_from(ProjectionEvent)) == 0
        edge = (await session.execute(select(GraphEdge))).scalar_one()
        assert edge.weight == pytest.approx(33_000.03)
        assert edge.tx_count == 5


async def test_postgres_cancel_release_race_has_one_terminal_winner(world: World) -> None:
    held = await world.evaluate(
        "alice", "scammer", 900_000, context={"active_call": True, "from_deposit": True}
    )
    assert held["status"] == "cooling_off"
    identity = held["transaction_id"]
    await world.expire_hold(identity)
    cancelled, released = await asyncio.gather(
        world.client.post(f"/api/v1/transfers/{identity}/cancel"),
        world.client.post(f"/api/v1/transfers/{identity}/resolve-cooling", json={"answers": CLEAN}),
    )
    assert sorted([cancelled.status_code, released.status_code]) == [200, 409]
    async with world.sessions() as session:
        tx = await session.get(Transaction, uuid.UUID(identity))
        assert tx is not None
        assert tx.status in {TransactionStatus.APPROVED, TransactionStatus.CANCELLED}
        edge_count = await session.scalar(select(func.count()).select_from(GraphEdge))
        assert edge_count == (2 if tx.status is TransactionStatus.APPROVED else 1)
        assert await session.scalar(select(func.count()).select_from(ProjectionEvent)) == 0


async def test_postgres_abandon_evaluate_race_never_breaks_no_execution_promise(
    world: World,
) -> None:
    identity = str(uuid.uuid4())
    request = {
        "request_id": identity,
        "sender_id": world.id("alice"),
        "recipient_id": world.id("bob"),
        "amount": "1000",
    }
    abandoned, evaluated = await asyncio.gather(
        world.client.post(f"/api/v1/transfers/requests/{identity}/abandon"),
        world.client.post("/api/v1/transfers/evaluate", json=request),
    )
    assert abandoned.status_code == 200
    async with world.sessions() as session:
        tx = await session.get(Transaction, uuid.UUID(identity))
        tombstone = await session.get(AbandonedRequest, uuid.UUID(identity))
        if abandoned.json()["status"] == "abandoned":
            assert evaluated.status_code == 409
            assert tx is None
            assert tombstone is not None
        else:
            assert evaluated.status_code == 200
            assert tx is not None
            assert tombstone is None
            assert abandoned.json()["evaluation"]["transaction_id"] == identity

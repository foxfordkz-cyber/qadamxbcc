"""Two independent scoring processes, each committing to the same hub."""

import asyncio
import multiprocessing
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import fakeredis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.db.base import Base
from app.db.session import build_session_factory
from app.models import Account
from app.services.antifraud import AntifraudEngine
from app.services.graph import GraphStore
from app.services.transfers import TransferService, upsert_transfer_edge


def db_engine(url: str, schema: str) -> AsyncEngine:
    options = {"server_settings": {"search_path": schema}} if url.startswith("postgresql") else {}
    return create_async_engine(url, connect_args=options)


async def prepare(url: str, schema: str, accounts: list[uuid.UUID]) -> None:
    engine = db_engine(url, schema)
    try:
        async with engine.begin() as conn:
            if url.startswith("postgresql"):
                await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            await conn.run_sync(Base.metadata.create_all)
        async with build_session_factory(engine)() as session:
            for i, account_id in enumerate(accounts):
                session.add(
                    Account(
                        id=account_id,
                        iin=f"{i:012}",
                        iban=f"KZ{i:018}",
                        phone=f"+7700000010{i}",
                        full_name=f"Fixture {i}",
                        device_id=f"d{i}",
                    )
                )
            await session.commit()
    finally:
        await engine.dispose()


def worker(
    url: str, schema: str, sender_id: uuid.UUID, hub_id: uuid.UUID, barrier: Any, results: Any
) -> None:
    async def execute() -> None:
        db = db_engine(url, schema)
        redis = fakeredis.FakeAsyncRedis()
        engine = AntifraudEngine(redis, GraphStore(), shared_graph_reads=True)
        try:
            async with build_session_factory(db)() as session:
                sender = await session.get(Account, sender_id)
                hub = await session.get(Account, hub_id)
                assert sender is not None
                assert hub is not None
                service = TransferService(session, engine)
                await service._refresh_device_peers(sender, hub, sender.device_id)
                assert service.engine.graph.metrics(str(hub_id)).in_degree == 0
                await session.commit()
                barrier.wait(60)
                await upsert_transfer_edge(session, sender_id, hub_id, 7000, datetime.now(UTC))
                await session.commit()
                barrier.wait(60)
                await service._refresh_device_peers(sender, hub, sender.device_id)
                metrics = service.engine.graph.metrics(str(hub_id))
                results.put((os.getpid(), metrics.in_degree, metrics.in_weight))
        finally:
            await redis.aclose()
            await db.dispose()

    asyncio.run(execute())


def test_two_scoring_workers_observe_one_hub(tmp_path: Path) -> None:
    url = (
        os.environ.get("BCC_TEST_POSTGRES_URL")
        or f"sqlite+aiosqlite:///{(tmp_path / 'hub.db').as_posix()}"
    )
    schema = "bcc_graph_" + uuid.uuid4().hex
    accounts = [uuid.uuid4() for _ in range(3)]
    asyncio.run(prepare(url, schema, accounts))
    context = multiprocessing.get_context("spawn")
    barrier, results = context.Barrier(2), context.Queue()
    children = [
        context.Process(target=worker, args=(url, schema, s, accounts[2], barrier, results))
        for s in accounts[:2]
    ]
    try:
        for child in children:
            child.start()
        for child in children:
            child.join(100)
            assert child.exitcode == 0
        outcomes = [results.get(timeout=5) for _ in children]
        assert len({pid for pid, _, _ in outcomes}) == 2
        assert [(count, total) for _, count, total in outcomes] == [(2, 14000), (2, 14000)]
    finally:
        for child in children:
            if child.is_alive():
                child.terminate()
                child.join(10)
        results.close()
        if url.startswith("postgresql"):

            async def cleanup() -> None:
                admin = create_async_engine(url)
                try:
                    async with admin.begin() as conn:
                        await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
                finally:
                    await admin.dispose()

            asyncio.run(cleanup())

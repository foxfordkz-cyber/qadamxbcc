"""Recover durable approvals before declaring the local projections ready.

The DB graph edge and outbox row commit together. Redis writes and graph additions
are idempotent until that outbox row is removed. A Redis epoch detects state loss.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from redis.asyncio import Redis
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import ProjectionEvent, Transaction, TransactionStatus
from app.services.antifraud import AntifraudEngine, TransferContext
from app.services.graph import GraphStore
from app.services.transfers import hydrate_graph

EPOCH_KEY = "bcc:projection:epoch"


def _context(tx: Transaction, *, settled: bool) -> TransferContext:
    return TransferContext(
        tx_id=str(tx.id),
        sender_id=str(tx.sender_id),
        recipient_id=str(tx.recipient_id),
        amount=float(tx.amount),
        device_id=tx.device_id,
        occurred_at=(tx.resolved_at or tx.created_at) if settled else tx.created_at,
    )


class ProjectionCoordinator:
    def __init__(
        self, factory: async_sessionmaker[AsyncSession], redis: Redis, engine: AntifraudEngine
    ) -> None:
        self.factory, self.redis, self.engine = factory, redis, engine
        self._lock = asyncio.Lock()
        self._epoch: bytes | str | None = None

    async def start(self) -> None:
        async with self._lock:
            await self._rebuild(await self.redis.get(EPOCH_KEY))
            await self._drain()

    async def synchronize(self) -> None:
        async with self._lock:
            epoch = await self.redis.get(EPOCH_KEY)
            if epoch is None or epoch != self._epoch:
                await self._rebuild(epoch)
            await self._drain()
            await self.engine.flush_settlements()

    async def _rebuild(self, epoch: bytes | str | None) -> None:
        graph = GraphStore()
        floor = datetime.now(UTC) - timedelta(hours=24)
        async with self.factory() as session:
            # Edges and pending IDs must belong to the same committed snapshot. Otherwise
            # a racing commit could be marked applied without appearing in the edge sums.
            if session.get_bind().dialect.name == "postgresql":
                await session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))
            else:
                await session.execute(text("BEGIN"))
            await hydrate_graph(
                session, graph, include_observed_devices=self.engine.allow_demo_overrides
            )
            pending_ids = list(await session.scalars(select(ProjectionEvent.transaction_id)))
            graph.mark_projected(str(value) for value in pending_ids)
            attempts = list(
                await session.scalars(select(Transaction).where(Transaction.created_at >= floor))
            )
            settled_at = func.coalesce(Transaction.resolved_at, Transaction.created_at)
            settled = list(
                await session.scalars(
                    select(Transaction).where(
                        Transaction.status == TransactionStatus.APPROVED,
                        settled_at >= floor,
                    )
                )
            )
        for tx in attempts:
            ctx = _context(tx, settled=False)
            await self.engine.velocity.record_attempt(
                tx_id=ctx.tx_id,
                sender_id=ctx.sender_id,
                recipient_id=ctx.recipient_id,
                amount=ctx.amount,
                ts=ctx.occurred_at.timestamp(),
            )
        for tx in settled:
            await self.engine.record_settled(_context(tx, settled=True))
        self.engine.graph = graph
        if epoch is None:
            await self.redis.set(EPOCH_KEY, str(uuid.uuid4()))
            epoch = await self.redis.get(EPOCH_KEY)
        self._epoch = epoch

    async def _drain(self) -> None:
        while True:
            async with self.factory() as session:
                transactions = list(
                    await session.scalars(
                        select(Transaction)
                        .join(ProjectionEvent, ProjectionEvent.transaction_id == Transaction.id)
                        .order_by(ProjectionEvent.created_at, ProjectionEvent.transaction_id)
                        .limit(100)
                    )
                )
                if not transactions:
                    return
                for tx in transactions:
                    if tx.status is not TransactionStatus.APPROVED:
                        raise RuntimeError("Projection outbox contains an unapproved transfer")
                    ctx = _context(tx, settled=True)
                    self.engine.apply_transfer(ctx)
                    await self.engine.record_settled(ctx)
                ids = [tx.id for tx in transactions]
                await session.execute(
                    delete(ProjectionEvent).where(ProjectionEvent.transaction_id.in_(ids))
                )
                await session.commit()
            # Once deletion is acknowledged no retry can reapply these IDs. Only failed
            # in-flight deliveries remain in the resident deduplication set.
            self.engine.graph.forget_projected(str(value) for value in ids)

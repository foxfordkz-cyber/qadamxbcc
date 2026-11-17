"""Process-wide resources (DB, Redis, resident graph, engine) owned by the app lifespan."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.db.session import build_engine, build_session_factory
from app.models import Transaction, TransactionStatus
from app.services.antifraud import AntifraudEngine, TransferContext
from app.services.graph import GraphStore
from app.services.transfers import hydrate_graph


@dataclass(slots=True)
class Resources:
    session_factory: async_sessionmaker[AsyncSession]
    redis: Redis
    engine: AntifraudEngine
    db_engine: AsyncEngine | None = None
    owns_connections: bool = True

    @classmethod
    def build(
        cls,
        settings: Settings,
        *,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        redis: Redis | None = None,
    ) -> "Resources":
        db_engine = None
        if session_factory is None:
            db_engine = build_engine(settings.database_url)
            session_factory = build_session_factory(db_engine)
        owns = redis is None
        redis_client = redis or Redis.from_url(settings.redis_url)
        engine = AntifraudEngine(
            redis_client,
            GraphStore(),
            timezone=settings.timezone,
            cooling_off_minutes=settings.cooling_off_minutes,
            allow_demo_overrides=settings.allow_demo_overrides,
        )
        return cls(session_factory, redis_client, engine, db_engine, owns)

    async def start(self) -> None:
        # Open the Redis connection now (fail fast) so the first scored transfer
        # does not pay the connect cost inside its latency budget.
        await self.redis.ping()
        async with self.session_factory() as session:
            await hydrate_graph(session, self.engine.graph)
            # Restore committed velocity after Redis loss or a crash between DB commit
            # and the Redis hook. Transaction IDs make this replay idempotent.
            settled_at = func.coalesce(Transaction.resolved_at, Transaction.created_at)
            recent = await session.scalars(
                select(Transaction).where(
                    Transaction.status == TransactionStatus.APPROVED,
                    settled_at >= datetime.now(UTC) - timedelta(hours=24),
                )
            )
            for tx in recent:
                at = tx.resolved_at or tx.created_at
                if at.tzinfo is None:
                    at = at.replace(tzinfo=UTC)
                await self.engine.record_settled(
                    TransferContext(
                        tx_id=str(tx.id),
                        sender_id=str(tx.sender_id),
                        recipient_id=str(tx.recipient_id),
                        amount=float(tx.amount),
                        device_id=tx.device_id,
                        occurred_at=at,
                    )
                )

    async def close(self) -> None:
        if self.owns_connections:
            await self.redis.aclose()
        if self.db_engine is not None:
            await self.db_engine.dispose()

"""Process-wide resources (DB, Redis, resident graph, engine) owned by the app lifespan."""

from dataclasses import dataclass

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.db.session import build_engine, build_session_factory
from app.services.antifraud import AntifraudEngine
from app.services.graph import GraphStore
from app.services.projections import ProjectionCoordinator


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
            allow_model_training=settings.environment != "pilot",
            use_virtual_wallet=settings.environment != "pilot",
        )
        return cls(session_factory, redis_client, engine, db_engine, owns)

    async def start(self) -> None:
        # Open the Redis connection now (fail fast) so the first scored transfer
        # does not pay the connect cost inside its latency budget.
        await self.redis.ping()
        coordinator = ProjectionCoordinator(self.session_factory, self.redis, self.engine)
        await coordinator.start()
        self.engine.synchronizer = coordinator.synchronize

    async def close(self) -> None:
        if self.owns_connections:
            await self.redis.aclose()
        if self.db_engine is not None:
            await self.db_engine.dispose()

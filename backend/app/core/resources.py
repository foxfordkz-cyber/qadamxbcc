"""Process-wide resources (DB, Redis, resident graph, engine) owned by the app lifespan."""

from dataclasses import dataclass

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.db.session import build_engine, build_session_factory
from app.services.antifraud import AntifraudEngine
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
        )
        return cls(session_factory, redis_client, engine, db_engine, owns)

    async def start(self) -> None:
        async with self.session_factory() as session:
            await hydrate_graph(session, self.engine.graph)

    async def close(self) -> None:
        if self.owns_connections:
            await self.redis.aclose()
        if self.db_engine is not None:
            await self.db_engine.dispose()

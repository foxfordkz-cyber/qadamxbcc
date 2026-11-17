"""Initialize an empty demo database only; never overwrite an existing dataset."""

import asyncio
import os

from redis.asyncio import Redis
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.db.session import build_engine, build_session_factory
from app.models import Account, GraphEdge, RiskEvent, Transaction


async def is_empty(factory: async_sessionmaker[AsyncSession]) -> bool:
    async with factory() as session:
        for model in (Account, Transaction, RiskEvent, GraphEdge):
            if await session.scalar(select(func.count()).select_from(model)):
                return False
    return True


async def main() -> None:
    if os.environ.get("BCC_BOOTSTRAP_DEMO", "false").lower() != "true":
        return
    settings = get_settings()
    if settings.environment not in {"local", "demo"}:
        raise RuntimeError("Demo bootstrap is forbidden outside local/demo environments")
    engine = build_engine(settings.database_url)
    redis = Redis.from_url(settings.redis_url)
    try:
        # Session-level lock spans seed's own transactions; parallel startups cannot both seed.
        async with engine.connect() as connection:
            postgres = connection.dialect.name == "postgresql"
            if postgres:
                await connection.execute(text("SELECT pg_advisory_lock(734910241)"))
            try:
                factory = build_session_factory(engine)
                if not await is_empty(factory):
                    print("Demo bootstrap: existing data preserved; no seed performed.", flush=True)
                    return
                # Avoid importing the training/scoring stack on an ordinary restart.
                from scripts.seed_bcc import render_summary, seed

                print(
                    "Demo bootstrap: initializing empty database with synthetic accounts.",
                    flush=True,
                )
                report = await seed(factory, redis)
                print(render_summary(report), flush=True)
            finally:
                if postgres:
                    await connection.execute(text("SELECT pg_advisory_unlock(734910241)"))
    finally:
        await redis.aclose()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())

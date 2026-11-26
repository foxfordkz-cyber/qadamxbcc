"""Guarded first bootstrap for the separate public staging; no core-store reset."""

import asyncio
import os
from urllib.parse import urlparse

from redis.asyncio import Redis
from sqlalchemy import text

from app.core.config import Settings, get_settings
from app.db.session import build_engine, build_session_factory
from scripts import bootstrap_demo


def validate_target(settings: Settings) -> None:
    database = urlparse(settings.database_url)
    cache = urlparse(settings.redis_url)
    if (
        settings.environment != "demo"
        or database.scheme != "postgresql+asyncpg"
        or database.path != "/saq_bol_staging"
        or database.username != "saq_bol_staging_owner"
        or cache.scheme not in {"redis", "rediss"}
        or cache.path != "/12"
        or cache.query
    ):
        raise ValueError("Staging requires its isolated PostgreSQL role/database and Redis DB 12")


async def prepare() -> None:
    settings = get_settings()
    validate_target(settings)
    engine = build_engine(settings.database_url)
    cache = Redis.from_url(settings.redis_url)
    try:
        async with engine.connect() as connection:
            if not await connection.scalar(
                text("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")
            ):
                raise RuntimeError("Staging PostgreSQL transport must use TLS")
        empty = await bootstrap_demo.is_empty(build_session_factory(engine))
        if empty and os.environ.get("BCC_BOOTSTRAP_DEMO", "false").lower() != "true":
            raise RuntimeError("Empty staging requires an explicitly authorized first bootstrap")
        if empty and await cache.dbsize():
            raise RuntimeError("Refusing bootstrap: the reserved Redis database is occupied")
    finally:
        await cache.aclose()
        await engine.dispose()
    await bootstrap_demo.main()
    # Existing bootstrap checks all core tables and never reseeds a nonempty store.


if __name__ == "__main__":
    asyncio.run(prepare())

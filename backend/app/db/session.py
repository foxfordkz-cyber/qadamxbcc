"""Async engine / session factory helpers."""

from typing import Any

from sqlalchemy import event
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import AsyncAdaptedQueuePool


def _sqlite_unicode(dbapi_connection: Any, _connection_record: Any) -> None:
    # sqlite3's built-in lower/NOCASE only folds ASCII. Keep Kazakh/Russian
    # searches in SQL without loading or filtering the account table in Python.
    dbapi_connection.create_function("bcc_casefold", 1, str.casefold, deterministic=True)


def build_engine(database_url: str) -> AsyncEngine:
    if database_url.startswith("sqlite"):
        url = make_url(database_url)
        if not url.database or ":memory:" in url.database or url.query.get("mode") == "memory":
            # Keep one memory database, but lease its connection to only one transaction
            # at a time. StaticPool allows overlapping sessions to roll each other back.
            engine = create_async_engine(
                database_url,
                connect_args={"check_same_thread": False},
                poolclass=AsyncAdaptedQueuePool,
                pool_size=1,
                max_overflow=0,
            )
        else:
            # File databases use separate connections for independent request transactions.
            engine = create_async_engine(
                database_url,
                connect_args={"check_same_thread": False},
            )
        event.listen(engine.sync_engine, "connect", _sqlite_unicode)
        return engine
    return create_async_engine(database_url, pool_size=10, max_overflow=20, pool_pre_ping=True)


def build_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)

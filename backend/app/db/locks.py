"""Transaction serialization shared by financial and SOC account-state writes."""

import asyncio
import hashlib
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from weakref import WeakKeyDictionary

from sqlalchemy import Connection, Engine, func, select
from sqlalchemy.ext.asyncio import AsyncSession

_SQLITE_LOCKS: WeakKeyDictionary[Engine, asyncio.Lock] = WeakKeyDictionary()


async def serialize_sender(session: AsyncSession, sender_id: uuid.UUID) -> None:
    """Serialize new sender decisions inside an existing serialized_identity scope.

    PostgreSQL's two-int namespace is separate from request UUID locks, so a
    caller-chosen request ID cannot acquire another sender's lock. SQLite already
    holds the shared database lock for the entire outer evaluate operation.
    """
    if session.get_bind().dialect.name == "postgresql":
        key = int.from_bytes(hashlib.sha256(sender_id.bytes).digest()[:4], "big", signed=True)
        await session.execute(select(func.pg_advisory_xact_lock(0x42434353, key)))


@asynccontextmanager
async def serialized_identity(session: AsyncSession, identity: uuid.UUID) -> AsyncIterator[None]:
    bind = session.get_bind()
    if bind.dialect.name == "postgresql":
        key = int.from_bytes(hashlib.sha256(identity.bytes).digest()[:8], "big", signed=True)
        await session.execute(select(func.pg_advisory_xact_lock(key)))
        yield
    else:
        engine = bind.engine if isinstance(bind, Connection) else bind
        lock = _SQLITE_LOCKS.setdefault(engine, asyncio.Lock())
        async with lock:
            yield

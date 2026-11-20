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

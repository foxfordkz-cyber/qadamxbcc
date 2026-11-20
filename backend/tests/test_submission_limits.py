import asyncio
import uuid
from typing import cast

import fakeredis.aioredis
import pytest
from redis.asyncio import Redis

from app.services import submission_limits as limits


async def test_distinct_intents_share_atomic_network_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = cast(Redis, fakeredis.aioredis.FakeRedis())
    monkeypatch.setattr(limits, "LIMIT", 2)
    try:
        first = uuid.uuid4()
        assert await limits.admit(redis, "office", first) == 0
        assert await limits.admit(redis, "office", first) == 0
        waits = await asyncio.gather(
            *(limits.admit(redis, "office", uuid.uuid4()) for _ in range(3))
        )
        assert waits.count(0) == 1
        assert all(0 < delay <= limits.COOLDOWN for delay in waits if delay)
        assert await limits.admit(redis, "office", first) == 0
        assert await limits.admit(redis, "other", None) == 0
        snapshot = await limits.summary(redis)
        assert (snapshot.active, snapshot.rejected) == (1, 2)
    finally:
        await redis.aclose()


async def test_cooldown_expires_without_extending_on_rejection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = cast(Redis, fakeredis.aioredis.FakeRedis())
    monkeypatch.setattr(limits, "WINDOW", 1)
    monkeypatch.setattr(limits, "LIMIT", 1)
    monkeypatch.setattr(limits, "COOLDOWN", 1)
    try:
        assert await limits.admit(redis, "mobile", None) == 0
        assert await limits.admit(redis, "mobile", None) == 1
        await asyncio.sleep(1.05)
        assert (await limits.summary(redis)).active == 0
        assert await limits.admit(redis, "mobile", None) == 0
    finally:
        await redis.aclose()

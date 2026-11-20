"""Short-lived transfer admission by pseudonymous gateway source, independent of risk scoring."""

import math
import time
import uuid

from redis.asyncio import Redis
from redis.exceptions import WatchError

from app.schemas.soc import SubmissionLimits

LIMIT = 20
WINDOW = 60
COOLDOWN = 60
ACTIVE = "saqbol:submission:active"
REJECTED = "saqbol:submission:rejected"


async def admit(redis: Redis, source: str, request_id: uuid.UUID | None) -> int:
    """Count distinct intents. Replays of recently admitted IDs keep their original outcome."""
    intents = f"saqbol:submission:{source}:ids"
    hold = f"saqbol:submission:{source}:hold"
    member = str(request_id or uuid.uuid4())
    while True:
        async with redis.pipeline() as pipe:
            try:
                await pipe.watch(intents, hold)
                now = time.time()
                cutoff = now - WINDOW
                seen = await pipe.zscore(intents, member)
                remaining = await pipe.pttl(hold)
                if seen is not None and (seen > cutoff or remaining >= 0):
                    return 0
                if remaining >= 0:
                    pipe.multi()  # type: ignore[no-untyped-call]  # redis-py omits the annotation
                    pipe.incr(REJECTED)
                    await pipe.execute()
                    return max(1, math.ceil(remaining / 1000))
                count = await pipe.zcount(intents, f"({cutoff}", "+inf")
                pipe.multi()  # type: ignore[no-untyped-call]
                if count >= LIMIT:
                    pipe.set(hold, "1", ex=COOLDOWN)
                    pipe.expire(intents, COOLDOWN + 1)
                    pipe.zremrangebyscore(ACTIVE, "-inf", now)
                    pipe.zadd(ACTIVE, {source: now + COOLDOWN})
                    pipe.expire(ACTIVE, COOLDOWN + 1)
                    pipe.incr(REJECTED)
                    await pipe.execute()
                    return COOLDOWN
                pipe.zremrangebyscore(intents, "-inf", cutoff)
                pipe.zadd(intents, {member: now})
                pipe.expire(intents, WINDOW + 1)
                await pipe.execute()
                return 0
            except WatchError:
                continue


async def summary(redis: Redis) -> SubmissionLimits:
    async with redis.pipeline(transaction=False) as pipe:
        pipe.zcount(ACTIVE, f"({time.time()}", "+inf")
        pipe.get(REJECTED)
        active, rejected = await pipe.execute()
    return SubmissionLimits(
        active=active,
        rejected=int(rejected or 0),
        limit=LIMIT,
        window_seconds=WINDOW,
        cooldown_seconds=COOLDOWN,
    )

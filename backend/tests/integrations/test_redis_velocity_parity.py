"""Compare the production and reference RESP3 parsers on the same isolated Redis keys."""

import os
from uuid import uuid4

import pytest
from redis._parsers import _AsyncHiredisParser, _AsyncRESP3Parser
from redis.asyncio import Redis
from redis.asyncio.connection import DefaultParser

from app.services.velocity import (
    KEY_PREFIX,
    MAX_HISTORY_ROWS,
    RETENTION_S,
    SettledPayee,
    VelocityCapacityError,
    VelocityCounters,
)


@pytest.mark.skipif(not os.getenv("BCC_TEST_REDIS_URL"), reason="Requires a real Redis service")
@pytest.mark.parametrize("decode_responses", [False, True])
async def test_resp3_parsers_return_the_same_complete_velocity_snapshot(
    decode_responses: bool,
) -> None:
    url = os.environ["BCC_TEST_REDIS_URL"]
    assert DefaultParser is _AsyncHiredisParser
    sender, recipient = uuid4().hex, uuid4().hex
    now = 100_000.5
    keys = [
        f"{KEY_PREFIX}:{direction}:{account}"
        for account in (sender, recipient)
        for direction in ("in", "out", "settled:in", "settled:out")
    ]
    async with (
        Redis.from_url(url, protocol=3, decode_responses=decode_responses) as native,
        Redis.from_url(
            url, protocol=3, decode_responses=decode_responses, parser_class=_AsyncRESP3Parser
        ) as python,
    ):
        try:
            pipe = native.pipeline()
            for index, key in enumerate(keys):
                entries = {
                    f"t-{j}:peer-{j % 11}:4.05": now - 14_400 for j in range(MAX_HISTORY_ROWS - 5)
                }
                entries.update(
                    {
                        f"recent:{recipient}:0.02": now,
                        "legacy:0.01": now - 600,
                        f"half-hour:other:{index}.01": now - 1_800,
                        f"hour:{recipient}:88.01": now - 3_600,
                        "bad:other:invalid": now - 10,
                        "expired:other:999": now - RETENTION_S,
                        "future:other:999": now + 1,
                    }
                )
                pipe.zadd(key, entries)
            await pipe.execute()
            baseline = await VelocityCounters(python).snapshot(
                sender_id=sender, recipient_id=recipient, ts=now
            )
            current = await VelocityCounters(native).snapshot(
                sender_id=sender, recipient_id=recipient, ts=now
            )
            assert current == baseline
            out = current.settled_sender_out
            assert [out.count(w) for w in ("10m", "30m", "1h", "24h")] == [
                1,
                2,
                3,
                MAX_HISTORY_ROWS - 1,
            ]
            assert current.settled_payee == SettledPayee(2, 88.03, 88.01)
            await native.zadd(keys[0], {"one-more:other:1.00": now})
            for client in (native, python):
                with pytest.raises(VelocityCapacityError, match="capacity"):
                    await VelocityCounters(client).snapshot(
                        sender_id=sender, recipient_id=recipient, ts=now
                    )
                assert await client.zcard(keys[0]) == MAX_HISTORY_ROWS + 3
        finally:
            await native.delete(*keys)

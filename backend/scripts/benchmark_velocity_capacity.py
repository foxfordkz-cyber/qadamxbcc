"""Measure full bounded snapshots and safe rejection; never benchmark bank throughput.

uv run python -m scripts.benchmark_velocity_capacity [--redis-url redis://localhost:6379/0]
Only this invocation's random keys are removed. Default transport is explicitly fakeredis.
"""

import argparse
import asyncio
import json
import statistics
import time
import uuid

from redis.asyncio import Redis

from app.services.velocity import (
    KEY_PREFIX,
    MAX_HISTORY_ROWS,
    VelocityCapacityError,
    VelocityCounters,
)


async def benchmark(
    redis_url: str | None = None, samples: int = 100, *, history_rows: int = MAX_HISTORY_ROWS
) -> dict[str, float | int | str]:
    if not 1 <= history_rows <= MAX_HISTORY_ROWS:
        raise ValueError("Benchmark rows must fit the configured capacity")
    if redis_url:
        redis = Redis.from_url(redis_url, socket_connect_timeout=2, socket_timeout=2)
    else:
        from fakeredis import FakeAsyncRedis

        redis = FakeAsyncRedis()
    prefix = uuid.uuid4().hex
    sender, recipient = f"{prefix}-sender", f"{prefix}-recipient"
    keys = [
        f"{KEY_PREFIX}:{direction}:{account}"
        for direction, account in (
            ("out", sender),
            ("in", sender),
            ("in", recipient),
            ("out", recipient),
            ("settled:out", sender),
            ("settled:in", sender),
            ("settled:in", recipient),
            ("settled:out", recipient),
        )
    ]
    try:
        await redis.ping()
        now = time.time()
        pipe = redis.pipeline(transaction=True)
        for key in keys:
            pipe.zadd(key, {f"{i}:party-{i}:100.00": now - 60 for i in range(history_rows)})
        await pipe.execute()
        velocity = VelocityCounters(redis, max_history_rows=history_rows)
        full: list[float] = []
        overloaded: list[float] = []
        for index in range(samples + 10):
            start = time.perf_counter_ns()
            await velocity.snapshot(sender_id=sender, recipient_id=recipient, ts=now)
            if index >= 10:
                full.append((time.perf_counter_ns() - start) / 1_000_000)
        await redis.zadd(keys[0], {f"excess-{i}:party-{i}:100.00": now - 60 for i in range(10_000)})
        for index in range(samples + 10):
            start = time.perf_counter_ns()
            try:
                await velocity.snapshot(sender_id=sender, recipient_id=recipient, ts=now)
            except VelocityCapacityError:
                if index >= 10:
                    overloaded.append((time.perf_counter_ns() - start) / 1_000_000)
            else:
                raise AssertionError("Incomplete history was incorrectly accepted")
        return {
            "redis": "real" if redis_url else "fakeredis",
            "samples_per_case": samples,
            "exact_rows_per_history": history_rows,
            "max_rows_transferred": 8 * (history_rows + 1),
            "eight_full_histories_p95_ms": statistics.quantiles(full, n=20)[-1],
            "overload_rejection_p95_ms": statistics.quantiles(overloaded, n=20)[-1],
            "overload_rejections": len(overloaded),
        }
    finally:
        await redis.delete(*keys)
        await redis.aclose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--redis-url")
    parser.add_argument("--history-rows", type=int, default=MAX_HISTORY_ROWS)
    args = parser.parse_args()
    print(
        json.dumps(asyncio.run(benchmark(args.redis_url, history_rows=args.history_rows)), indent=2)
    )


if __name__ == "__main__":
    main()

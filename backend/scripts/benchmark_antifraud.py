"""Measure warmed scorer latency (includes Redis; excludes HTTP/SQL persistence).

uv run python -m scripts.benchmark_antifraud [--redis-url redis://localhost:6379/0]
Without a URL this uses fakeredis, explicitly reported in the output.
"""

import argparse
import asyncio
import json
import statistics
import time
import uuid
from datetime import UTC, datetime

from redis.asyncio import Redis

from app.ml.features import Features
from app.ml.model import get_model
from app.services.antifraud import AntifraudEngine, TransferContext
from app.services.graph import GraphStore


async def benchmark(samples: int = 500, redis_url: str | None = None) -> dict[str, float | str]:
    if redis_url:
        redis = Redis.from_url(redis_url, socket_connect_timeout=3, socket_timeout=3)
    else:
        from fakeredis import FakeAsyncRedis

        redis = FakeAsyncRedis()
    try:
        await redis.ping()
        graph = GraphStore()
        prefix = uuid.uuid4().hex
        for i in range(300):
            graph.add_transfer(f"{prefix}s{i % 40}", f"{prefix}r{i % 25}", 1000 + i)
        engine = AntifraudEngine(redis, graph)
        model = get_model()
        features = Features(active_call=True, paste_detected=True, amount_ratio=8)
        ml_times: list[float] = []
        engine_times: list[float] = []
        for i in range(samples + 30):
            ctx = TransferContext(
                tx_id=f"{prefix}-{i}",
                sender_id=f"{prefix}s{i % 40}",
                recipient_id=f"{prefix}r{i % 25}",
                amount=5000,
                sender_avg_amount=25_000,
                device_id=f"{prefix}device{i % 40}",
                occurred_at=datetime.now(UTC),
                active_call=i % 3 == 0,
                pasted_recipient=i % 4 == 0,
            )
            start = time.perf_counter_ns()
            model.score(features)
            ml_ms = (time.perf_counter_ns() - start) / 1_000_000
            start = time.perf_counter_ns()
            await engine.evaluate(ctx)
            engine_ms = (time.perf_counter_ns() - start) / 1_000_000
            if i >= 30:
                ml_times.append(ml_ms)
                engine_times.append(engine_ms)
        return {
            "redis": "real" if redis_url else "fakeredis",
            "samples": float(samples),
            "ml_p95_ms": statistics.quantiles(ml_times, n=20)[-1],
            "engine_p50_ms": statistics.median(engine_times),
            "engine_p95_ms": statistics.quantiles(engine_times, n=20)[-1],
        }
    finally:
        await redis.aclose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--redis-url")
    args = parser.parse_args()
    result = asyncio.run(benchmark(redis_url=args.redis_url))
    print(json.dumps(result, indent=2))
    if float(result["ml_p95_ms"]) >= 2 or float(result["engine_p95_ms"]) >= 15:
        raise SystemExit("Latency budget exceeded")


if __name__ == "__main__":
    main()

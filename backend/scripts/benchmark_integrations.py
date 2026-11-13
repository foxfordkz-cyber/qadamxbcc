"""Repeatable engine-only benchmark. No HTTP/PostgreSQL or production SLA claims."""

import asyncio
import json
import statistics
import time
import uuid
from datetime import UTC, datetime

import fakeredis

from app.services.antifraud import AntifraudEngine, TransferContext
from app.services.graph import GraphStore


async def benchmark() -> dict[str, object]:
    runs: list[dict[str, float | int]] = []
    for _ in range(3):
        redis = fakeredis.FakeAsyncRedis()
        await redis.ping()
        engine = AntifraudEngine(redis, GraphStore())
        for i in range(300):
            engine.graph.add_transfer(f"s{i % 40}", f"r{i % 25}", 1000 + i)
        samples: list[float] = []
        for i in range(200):
            start = time.perf_counter()
            await engine.evaluate(
                TransferContext(
                    tx_id=str(uuid.uuid4()),
                    sender_id=f"s{i % 40}",
                    recipient_id=f"r{i % 25}",
                    amount=5000,
                    device_id=f"dev-s{i % 40}",
                    occurred_at=datetime(2026, 11, 13, 9, 0, tzinfo=UTC),
                    sender_avg_amount=25000,
                    active_call=i % 3 == 0,
                )
            )
            samples.append((time.perf_counter() - start) * 1000)
        runs.append(
            {
                "count": len(samples),
                "median_ms": statistics.median(samples),
                "p95_ms": statistics.quantiles(samples, n=20)[-1],
            }
        )
        await redis.aclose()
    return {"provider": "fakeredis", "scope": "engine only; no HTTP/DB", "runs": runs}


if __name__ == "__main__":
    print(json.dumps(asyncio.run(benchmark())))

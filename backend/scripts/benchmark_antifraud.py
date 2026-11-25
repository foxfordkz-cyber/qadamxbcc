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
from dataclasses import replace
from datetime import UTC, datetime

from redis.asyncio import Redis

from app.services.antifraud import AntifraudEngine, TransferContext
from app.services.graph import GraphStore


async def benchmark(
    samples: int = 500, redis_url: str | None = None, *, familiar_calls: bool = False
) -> dict[str, float | str]:
    if samples < 2:
        raise ValueError("At least two measured samples are required")
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
        engine = AntifraudEngine(redis, graph, observe_familiar_calls=True)
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
            if familiar_calls:
                payer, recipient = f"{prefix}f{i}", f"{prefix}k{i}"
                graph.add_transfer(payer, recipient, 25000)
                ctx = replace(
                    ctx,
                    sender_id=payer,
                    recipient_id=recipient,
                    device_id=payer,
                    occurred_at=ctx.occurred_at.replace(hour=9),
                    active_call=True,
                    pasted_recipient=False,
                    typing_duration_ms=9500,
                    recipient_input_length=12,
                    hesitation_ms=4000,
                    hesitation_count=2,
                )
            start = time.perf_counter_ns()
            evaluated = await engine.evaluate(ctx)
            engine_ms = (time.perf_counter_ns() - start) / 1_000_000
            if familiar_calls and evaluated.shadow_prediction is None:
                raise RuntimeError("Familiar-call benchmark missed the observation path")
            if i >= 30:
                ml_times.append(evaluated.layer_latency_ms["ml"])
                engine_times.append(engine_ms)
        return {
            "scope": "single-request warmed scoring; HTTP and SQL persistence excluded",
            "workload": (
                "Independent known-payee calls with browser measurements; both models scored"
                if familiar_calls
                else "40 senders, 25 recipients; 300 initial transfer updates"
            ),
            "redis": "real" if redis_url else "fakeredis",
            "samples": float(samples),
            "quantiles": "inclusive linear interpolation",
            "ml_p95_ms": statistics.quantiles(ml_times, n=100, method="inclusive")[94],
            "engine_p50_ms": statistics.median(engine_times),
            "engine_p95_ms": statistics.quantiles(engine_times, n=100, method="inclusive")[94],
            "engine_p99_ms": statistics.quantiles(engine_times, n=100, method="inclusive")[98],
        }
    finally:
        await redis.aclose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--redis-url")
    parser.add_argument("--samples", type=int, default=500)
    parser.add_argument("--familiar-calls", action="store_true")
    args = parser.parse_args()
    result = asyncio.run(
        benchmark(args.samples, args.redis_url, familiar_calls=args.familiar_calls)
    )
    print(json.dumps(result, indent=2))
    if float(result["ml_p95_ms"]) >= 2 or float(result["engine_p95_ms"]) >= 15:
        raise SystemExit("Latency budget exceeded")


if __name__ == "__main__":
    main()

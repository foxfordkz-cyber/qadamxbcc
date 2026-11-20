"""Replay a fixed ordinary-payment workload in a fresh, in-process synthetic bank.

From backend/ run: uv run python -m scripts.benchmark_ordinary_transfers
For independent trials, repeat the command in separate processes.
"""

import asyncio
import json
import statistics
import time
from collections import Counter
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from fakeredis import FakeAsyncRedis
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.kz import make_kz_iban
from app.core.resources import Resources
from app.db.base import Base
from app.db.session import build_engine, build_session_factory
from app.main import create_app
from app.models import Account, EdgeType, GraphEdge

EVENT_TIME = datetime(2026, 11, 20, 9, tzinfo=UTC)
WARMUP, SAMPLES = 25, 180
AMOUNTS = (5_000, 12_500, 22_000, 31_000)
# The original run also seeded twelve independent functional-control pairs.
# Three had prior payments. Their requests followed the timed phase.
EXTRA_KNOWN = (True, False, False, False, True, False, False, False, False, True, False, False)


def account(number: int) -> Account:
    return Account(
        id=UUID(int=number),
        iin=f"9001013{number:05d}",
        iban=make_kz_iban(f"{number:013d}"),
        phone=f"+7701{number:07d}",
        full_name=f"Sample {number}",
        device_id=f"sample-{number}",
        avg_tx_amount=Decimal("42000"),
    )


async def seed_pairs(session: AsyncSession) -> None:
    pairs_known = [i % 2 == 0 for i in range(WARMUP + SAMPLES)] + list(EXTRA_KNOWN)
    for i, known in enumerate(pairs_known):
        sender = account(2 * i + 1)
        payee = account(2 * i + 2)
        session.add_all([sender, payee])
        if known:
            session.add(
                GraphEdge(
                    source_id=sender.id,
                    target_id=payee.id,
                    edge_type=EdgeType.TRANSFER,
                    weight=58_000,
                    tx_count=3,
                    last_seen_at=EVENT_TIME - timedelta(days=5),
                )
            )
    await session.commit()


def percentiles(values: list[float]) -> dict[str, float]:
    cutoffs = statistics.quantiles(values, n=100, method="inclusive")
    return {"p50_ms": round(cutoffs[49], 3), "p95_ms": round(cutoffs[94], 3)}


async def run() -> dict[str, object]:
    db = build_engine("sqlite+aiosqlite:///:memory:")
    sessions = build_session_factory(db)
    redis = FakeAsyncRedis()
    try:
        async with db.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with sessions() as session:
            await seed_pairs(session)
        settings = Settings(
            environment="local",
            database_url="sqlite+aiosqlite:///:memory:",
            allow_demo_overrides=True,
            timezone="Asia/Almaty",
            api_key=None,
            soc_api_key=None,
            render_telegram_test=False,
            request_rate_limit_per_minute=10_000,
        )
        app = create_app(settings, Resources.build(settings, session_factory=sessions, redis=redis))
        app.state.integration_settings = app.state.integration_settings.model_copy(
            update={"enabled": False}
        )
        statuses: Counter[str] = Counter()
        requests: list[float] = []
        scorer: list[float] = []
        async with (
            app.router.lifespan_context(app),
            AsyncClient(
                transport=ASGITransport(app=app),
                base_url="http://synthetic.test",
                trust_env=False,
            ) as client,
        ):
            for i in range(WARMUP + SAMPLES):
                payload = {
                    "request_id": str(UUID(int=10_000 + i)),
                    "sender_id": str(UUID(int=2 * i + 1)),
                    "recipient_id": str(UUID(int=2 * i + 2)),
                    "amount": str(AMOUNTS[i % len(AMOUNTS)]),
                    "occurred_at": EVENT_TIME.isoformat(),
                    "context": {
                        "active_call": False,
                        "typing_duration_ms": 2600,
                        "hesitation_count": 0,
                    },
                }
                start = time.perf_counter_ns()
                response = await client.post("/api/v1/transfers/evaluate", json=payload)
                elapsed = (time.perf_counter_ns() - start) / 1e6
                response.raise_for_status()
                result = response.json()
                if i >= WARMUP:
                    statuses[result["status"]] += 1
                    requests.append(elapsed)
                    scorer.append(result["latency_ms"])
        return {
            "samples": SAMPLES,
            "warmup": WARMUP,
            "decisions": dict(statuses),
            "request": percentiles(requests),
            "scorer": percentiles(scorer),
        }
    finally:
        await redis.aclose()
        await db.dispose()


if __name__ == "__main__":
    result = asyncio.run(run())
    print(json.dumps(result, indent=2))
    if result["decisions"] != {"approved": SAMPLES}:
        raise SystemExit("At least one ordinary payment required intervention")

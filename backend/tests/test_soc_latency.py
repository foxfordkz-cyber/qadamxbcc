"""A bounded percentile of real scorer measurements, never seed zeros or HTTP time."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.models import Transaction, TransactionStatus
from tests.test_api import API, World
from tests.test_api import world as world


async def observations(
    world: World, values: list[float], *, start_id: int = 1, age_days: int = 0
) -> None:
    timestamp = datetime.now(UTC) - timedelta(days=age_days)
    async with world.sessions() as session:
        for index, value in enumerate(values):
            session.add(
                Transaction(
                    id=uuid.UUID(int=start_id + index),
                    sender_id=world.acc["alice"].id,
                    recipient_id=world.acc["bob"].id,
                    amount=Decimal("1000"),
                    status=TransactionStatus.APPROVED,
                    risk_score=0,
                    device_id="synthetic-device",
                    latency_ms=value,
                    created_at=timestamp,
                    # Recently changed old cases must not re-enter the scoring window.
                    updated_at=datetime.now(UTC),
                )
            )
        await session.commit()


async def test_empty_or_unmeasured_history_has_no_percentile(world: World) -> None:
    for values in ([], [0.0] * 30):
        await observations(world, values)
        response = await world.client.get(f"{API}/soc/feed")
        assert response.status_code == 200
        stats = response.json()["stats"]
        assert stats["p95_latency_ms"] is None
        assert stats["latency_sample_size"] == 0
        assert stats["latency_sample_limit"] == 500
    await observations(world, [8.125], start_id=100)
    stats = (await world.client.get(f"{API}/soc/feed")).json()["stats"]
    assert stats["p95_latency_ms"] == 8.125
    assert stats["latency_sample_size"] == 1


async def test_nearest_rank_percentile_is_global_across_feed_filters(world: World) -> None:
    await observations(world, [float(value) for value in range(1, 21)])
    for params in (
        {"limit": "1"},
        {"q": "no matching name"},
        {"status": "blocked", "min_score": "90", "offset": "20"},
        {"since": datetime.now(UTC).isoformat()},
    ):
        response = await world.client.get(f"{API}/soc/feed", params=params)
        assert response.status_code == 200
        stats = response.json()["stats"]
        assert stats["p95_latency_ms"] == 19.0
        assert stats["latency_sample_size"] == 20


async def test_window_uses_500_latest_created_measurements_with_uuid_tie_break(
    world: World,
) -> None:
    # All have the same timestamp: UUID DESC chooses indices 31..530, not 1..500.
    await observations(world, [9999.0] * 30 + [float(value) for value in range(1, 501)])
    # An old case updated now must not displace a more recent scorer observation.
    await observations(world, [9999.0] * 30, start_id=1000, age_days=2)
    # New seed rows do not consume the 500-measurement budget.
    await observations(world, [0.0] * 30, start_id=2000)
    response = await world.client.get(f"{API}/soc/feed", params={"limit": 1})
    assert response.status_code == 200
    stats = response.json()["stats"]
    assert stats["total"] == 590
    assert stats["latency_sample_size"] == 500
    assert stats["p95_latency_ms"] == 475.0

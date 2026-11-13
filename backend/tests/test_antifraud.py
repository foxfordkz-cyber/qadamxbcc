import statistics
import time
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import fakeredis
import pytest

from app.models import TransactionStatus
from app.services.antifraud import (
    BLOCK_THRESHOLD,
    COOLING_OFF_THRESHOLD,
    AntifraudEngine,
    Evaluation,
    TransferContext,
    decide,
)
from app.services.graph import GraphStore

DAY = datetime(2026, 11, 13, 9, 0, tzinfo=UTC)  # 14:00 Asia/Almaty
NIGHT = datetime(2026, 11, 12, 21, 30, tzinfo=UTC)  # 02:30 Asia/Almaty


@pytest.fixture
async def engine() -> AsyncIterator[AntifraudEngine]:
    redis = fakeredis.FakeAsyncRedis()
    await redis.ping()  # warm the connection, as Resources.start() does in production
    graph = GraphStore()
    yield AntifraudEngine(redis, graph)
    await redis.aclose()


def ctx(
    sender: str,
    recipient: str,
    amount: float = 20_000,
    *,
    at: datetime = DAY,
    device: str | None = None,
    avg: float = 25_000,
    **flags: bool,
) -> TransferContext:
    return TransferContext(
        tx_id=str(uuid.uuid4()),
        sender_id=sender,
        recipient_id=recipient,
        amount=amount,
        device_id=device or f"dev-{sender}",
        occurred_at=at,
        sender_avg_amount=avg,
        **flags,
    )


async def run(engine: AntifraudEngine, c: TransferContext) -> Evaluation:
    result = await engine.evaluate(c)
    if result.decision is TransactionStatus.APPROVED:
        engine.apply_transfer(c)
    return result


def codes(e: Evaluation) -> set[str]:
    return {r.code for r in e.reasons}


def test_decision_thresholds() -> None:
    assert decide(0) is TransactionStatus.APPROVED
    assert decide(COOLING_OFF_THRESHOLD - 1) is TransactionStatus.APPROVED
    assert decide(COOLING_OFF_THRESHOLD) is TransactionStatus.COOLING_OFF
    assert decide(BLOCK_THRESHOLD - 1) is TransactionStatus.COOLING_OFF
    assert decide(BLOCK_THRESHOLD) is TransactionStatus.BLOCKED
    assert decide(100) is TransactionStatus.BLOCKED


async def test_scenario_1_legitimate_p2p_is_approved(engine: AntifraudEngine) -> None:
    engine.graph.add_account("alice", device_id="dev-alice")
    engine.graph.add_transfer("alice", "bob", 15_000)  # known recipient

    result = await run(engine, ctx("alice", "bob", 18_000))

    assert result.decision is TransactionStatus.APPROVED
    assert result.score == 0
    assert result.reasons == []
    assert result.headline_ru == "Перевод одобрен."
    assert result.latency_ms < 50


async def test_new_recipient_alone_stays_frictionless(engine: AntifraudEngine) -> None:
    result = await run(engine, ctx("alice", "carol", 30_000))
    assert result.decision is TransactionStatus.APPROVED
    assert codes(result) == {"NEW_RECIPIENT"}


async def test_scenario_2_social_engineering_triggers_cooling_off(
    engine: AntifraudEngine,
) -> None:
    result = await run(
        engine,
        ctx("victim", "scammer", 2_500_000, avg=40_000, active_call=True, from_deposit=True),
    )

    assert result.decision is TransactionStatus.COOLING_OFF
    assert {
        "ACTIVE_CALL",
        "DEPOSIT_WITHDRAWAL",
        "NEW_RECIPIENT",
        "AMOUNT_SPIKE",
        "SOCIAL_ENGINEERING_PATTERN",
    } <= codes(result)
    # behavioral-only evidence is capped below the block threshold (adaptive cooling-off)
    assert result.score == BLOCK_THRESHOLD - 1
    assert len(result.reasons_kk) == len(result.reasons_ru) == len(result.reasons)
    assert any("қоңырау" in r for r in result.reasons_kk)
    assert any("звонок" in r for r in result.reasons_ru)
    assert "15" in result.headline_kk
    assert "15" in result.headline_ru


async def _build_drop_hub(engine: AntifraudEngine, *, cash_out: bool) -> None:
    start = DAY - timedelta(minutes=29)
    for i in range(12):
        feeder = f"feeder{i}"
        engine.graph.add_account(feeder, device_id=f"dev-{feeder}")
        await run(engine, ctx(feeder, "hub", 95_000, at=start + timedelta(minutes=2 * i)))
    if cash_out:
        out = await run(engine, ctx("hub", "cashout", 1_100_000, at=DAY - timedelta(minutes=4)))
        assert "SENDER_PASS_THROUGH" in codes(out)
        engine.apply_transfer(ctx("hub", "cashout", 1_100_000, at=DAY - timedelta(minutes=4)))


async def test_scenario_3_drop_hub_is_blocked(engine: AntifraudEngine) -> None:
    await _build_drop_hub(engine, cash_out=True)

    result = await run(engine, ctx("victim", "hub", 300_000, avg=60_000))

    assert result.decision is TransactionStatus.BLOCKED
    assert result.score >= BLOCK_THRESHOLD
    assert {"DROP_HUB_FAN_IN", "RECIPIENT_MANY_SENDERS"} <= codes(result)
    assert codes(result) & {"RECIPIENT_INSTANT_CASHOUT", "RECIPIENT_TRANSIT_RATIO"}
    assert result.recipient_graph.suspected_mule
    assert any("дроп" in r for r in result.reasons_ru)


async def test_popular_recipient_without_cashout_is_not_blocked(
    engine: AntifraudEngine,
) -> None:
    """False-positive guard: a birthday collection (fan-in, money stays) is never blocked."""
    await _build_drop_hub(engine, cash_out=False)

    result = await run(engine, ctx("friend", "hub", 10_000, avg=12_000))

    assert result.decision is TransactionStatus.APPROVED
    assert {"DROP_HUB_FAN_IN", "RECIPIENT_MANY_SENDERS", "FAN_IN_UNCORROBORATED"} <= codes(result)
    fan_in = next(r for r in result.reasons if r.code == "DROP_HUB_FAN_IN")
    assert fan_in.evidence["corroborated"] is False


async def test_scenario_4_new_device_at_night(engine: AntifraudEngine) -> None:
    engine.graph.add_account("dana", device_id="dev-dana")
    result = await run(
        engine,
        ctx("dana", "unknown", 90_000, at=NIGHT, device="dev-new", avg=30_000, is_new_device=True),
    )

    assert result.decision is TransactionStatus.COOLING_OFF
    assert {"NEW_DEVICE", "NIGHT_HOURS", "ACCOUNT_TAKEOVER_PATTERN"} <= codes(result)
    night = next(r for r in result.reasons if r.code == "NIGHT_HOURS")
    assert "02:30" in night.reason_kk
    assert "02:30" in night.reason_ru


async def test_shared_device_mule_cluster(engine: AntifraudEngine) -> None:
    for mule in ("m1", "m2", "m3"):
        engine.graph.add_account(mule, device_id="burner-phone")

    result = await run(engine, ctx("payer", "m1", 50_000))

    shared = next(r for r in result.reasons if r.code == "RECIPIENT_SHARED_DEVICE")
    assert shared.evidence["n"] == 2

    takeover = await run(engine, ctx("m2victim", "x", 5_000, device="burner-phone"))
    assert "SENDER_DEVICE_SHARED" in codes(takeover)


async def test_flagged_recipient_with_context_is_blocked(engine: AntifraudEngine) -> None:
    engine.graph.add_account("mule", flagged=True)
    result = await run(engine, ctx("p", "mule", 100_000, active_call=True))
    assert result.decision is TransactionStatus.BLOCKED
    assert "RECIPIENT_FLAGGED" in codes(result)


async def test_velocity_is_idempotent_per_tx(engine: AntifraudEngine) -> None:
    c = ctx("a", "b", 1_000)
    await engine.evaluate(c)
    second = await engine.evaluate(c)
    assert second.velocity.sender_out.count("10m") == 1
    assert second.velocity.recipient_in.count("24h") == 1
    assert second.velocity.recipient_in.volume("24h") == pytest.approx(1_000)


async def test_sender_burst(engine: AntifraudEngine) -> None:
    result = None
    for i in range(5):
        result = await engine.evaluate(ctx("burst", f"r{i}", 5_000, at=DAY + timedelta(seconds=i)))
    assert result is not None
    assert "SENDER_BURST" in codes(result)


async def test_p95_latency_under_budget(engine: AntifraudEngine) -> None:
    for i in range(300):
        engine.graph.add_transfer(f"s{i % 40}", f"r{i % 25}", 1_000 + i)
    samples: list[float] = []
    for i in range(200):
        t = time.perf_counter()
        await engine.evaluate(ctx(f"s{i % 40}", f"r{i % 25}", 5_000, active_call=i % 3 == 0))
        samples.append((time.perf_counter() - t) * 1000)
    p95 = statistics.quantiles(samples, n=20)[-1]
    assert p95 < 50, f"p95={p95:.2f}ms"


async def test_repeat_payer_to_known_recipient_is_not_a_drop_hub(
    engine: AntifraudEngine,
) -> None:
    """Regression (live smoke): fan-in must count distinct senders, not transfers."""
    engine.graph.add_transfer("payer", "landlord", 50_000)
    result = None
    for i in range(15):
        result = await run(
            engine, ctx("payer", "landlord", 1_000 + i, at=DAY + timedelta(minutes=i))
        )
    assert result is not None
    assert result.decision is TransactionStatus.APPROVED
    assert not codes(result) & {"DROP_HUB_FAN_IN", "FAN_IN_VELOCITY"}
    assert result.velocity.recipient_in.count("30m") == 15
    assert result.velocity.recipient_in.distinct("30m") == 1

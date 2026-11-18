"""Attempt detection must not manufacture evidence of completed cash-out."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import fakeredis
import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from app.services.antifraud import AntifraudEngine, TransferContext
from app.services.graph import GraphStore

NOW = datetime(2026, 11, 17, 9, tzinfo=UTC)


def context(tx: str, sender: str, recipient: str, amount: float = 20_000) -> TransferContext:
    return TransferContext(tx, sender, recipient, amount, f"dev-{sender}", NOW, 25_000)


async def test_held_cashout_attempt_is_not_recipient_transit_evidence() -> None:
    redis = fakeredis.FakeAsyncRedis()
    engine = AntifraudEngine(redis, GraphStore())
    try:
        for index in range(3):
            incoming = context(f"in-{index}", f"payer-{index}", "hub")
            await engine.record_settled(incoming)
            engine.apply_transfer(incoming)
        outgoing = replace(context("held-out", "hub", "cashout", 55_000), active_call=True)
        first = await engine.evaluate(outgoing)
        assert first.decision.value in {"cooling_off", "blocked"}
        following = await engine.evaluate(context("next-in", "another", "hub"))
        assert following.velocity.recipient_out.volume("1h") == 55_000
        assert following.velocity.settled_recipient_out.volume("1h") == 0
        assert "RECIPIENT_INSTANT_CASHOUT" not in {r.code for r in following.reasons}
        assert "RECIPIENT_TRANSIT_RATIO" not in {r.code for r in following.reasons}
        assert not following.recipient_graph.suspected_mule
    finally:
        await redis.aclose()


async def test_committed_cashout_is_visible_and_settlement_retry_is_idempotent() -> None:
    redis = fakeredis.FakeAsyncRedis()
    engine = AntifraudEngine(redis, GraphStore())
    try:
        for index in range(3):
            await engine.record_settled(context(f"in-{index}", f"payer-{index}", "hub"))
        outgoing = context("out", "hub", "cashout", 55_000)
        await engine.record_settled(outgoing)
        await engine.record_settled(replace(outgoing, occurred_at=NOW + timedelta(minutes=1)))
        following = await engine.evaluate(
            replace(context("next-in", "another", "hub"), occurred_at=NOW + timedelta(minutes=2))
        )
        assert following.velocity.settled_recipient_out.count("1h") == 1
        assert following.velocity.settled_recipient_out.volume("1h") == 55_000
        assert "RECIPIENT_INSTANT_CASHOUT" in {r.code for r in following.reasons}
    finally:
        await redis.aclose()


async def test_authoritative_context_ignores_client_time_and_relationship_flags() -> None:
    redis = fakeredis.FakeAsyncRedis()
    engine = AntifraudEngine(redis, GraphStore(), allow_demo_overrides=False)
    try:
        supplied = replace(context("tx", "payer", "recipient"), is_new_recipient=False)
        before = datetime.now(UTC)
        trusted = engine.trusted_context(supplied, known_device_id="previous-device")
        assert before <= trusted.occurred_at <= datetime.now(UTC)
        assert trusted.is_new_recipient is True
        assert trusted.is_new_device is True
        engine.graph.add_transfer("payer", "recipient", 500)
        trusted = engine.trusted_context(
            replace(supplied, is_new_recipient=True, is_new_device=True),
            known_device_id=supplied.device_id,
        )
        assert trusted.is_new_recipient is False
        assert trusted.is_new_device is False
    finally:
        await redis.aclose()


async def test_failed_settlement_retries_before_scoring(monkeypatch: pytest.MonkeyPatch) -> None:
    redis = fakeredis.FakeAsyncRedis()
    engine = AntifraudEngine(redis, GraphStore())
    original = engine.velocity.record_settled

    async def unavailable(**kwargs: object) -> None:
        raise RedisConnectionError("unavailable")

    try:
        monkeypatch.setattr(engine.velocity, "record_settled", unavailable)
        with pytest.raises(RedisConnectionError):
            await engine.record_settled(context("settled", "payer", "hub"))
        with pytest.raises(RedisConnectionError):
            await engine.evaluate(context("next", "another", "hub"))
        monkeypatch.setattr(engine.velocity, "record_settled", original)
        result = await engine.evaluate(context("next", "another", "hub"))
        assert result.velocity.settled_recipient_in.volume("1h") == 20_000
        assert result.velocity.recipient_in.count("1h") == 1
    finally:
        await redis.aclose()

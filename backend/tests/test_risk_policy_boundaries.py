"""Friction signals cannot become mule proof merely by accumulating points."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from itertools import product

import fakeredis
import pytest
from pydantic import SecretStr, ValidationError

from app.core.config import Settings
from app.ml.model import Prediction
from app.services.antifraud import AntifraudEngine, TransferContext
from app.services.graph import GraphStore

DAY = datetime(2026, 11, 17, 9, tzinfo=UTC)


def context(tx_id: str = "tx") -> TransferContext:
    return TransferContext(
        tx_id,
        "payer",
        "recipient",
        900_000,
        "payer-device",
        DAY,
        25_000,
        active_call=True,
        from_deposit=True,
    )


async def test_repeated_scam_attempts_preserve_cooling_without_mule_evidence() -> None:
    redis = fakeredis.FakeAsyncRedis()
    engine = AntifraudEngine(redis, GraphStore())
    try:
        for index in range(8):
            result = await engine.evaluate(context(f"attempt-{index}"))
            assert result.decision.value == "cooling_off"
            assert result.score == 74
            if index >= 4:
                assert "SENDER_BURST" in {reason.code for reason in result.reasons}
        assert not engine.graph.metrics("recipient").suspected_mule
    finally:
        await redis.aclose()


async def test_family_collection_with_shared_tablet_needs_independent_movement_to_block(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = fakeredis.FakeAsyncRedis()
    graph = GraphStore()
    for account in ("recipient", "family-1", "family-2"):
        graph.add_account(account, device_id="family-tablet")
    engine = AntifraudEngine(redis, graph)
    monkeypatch.setattr(engine.model, "score", lambda _: Prediction(100, 0, ()))
    try:
        for index in range(12):
            incoming = replace(
                context(f"incoming-{index}"), sender_id=f"guest-{index}", amount=100_000
            )
            await engine.velocity.record_and_snapshot(
                tx_id=incoming.tx_id,
                sender_id=incoming.sender_id,
                recipient_id=incoming.recipient_id,
                amount=incoming.amount,
                ts=DAY.timestamp(),
            )
            await engine.record_settled(incoming)
            engine.apply_transfer(incoming)
        assert not graph.metrics("recipient").suspected_mule
        # Even worst-case ML and every combination of browser context must not
        # invent independent money movement. Retried attempts also build a burst.
        for index, flags in enumerate(product((False, True), repeat=5)):
            call, deposit, new_device, pasted, night = flags
            result = await engine.evaluate(
                replace(
                    context(f"combo-{index}"),
                    active_call=call,
                    from_deposit=deposit,
                    is_new_device=new_device,
                    pasted_recipient=pasted,
                    occurred_at=DAY + timedelta(hours=12) if night else DAY,
                )
            )
            assert result.score <= 74
            assert result.decision.value != "blocked"
            assert "RECIPIENT_SHARED_DEVICE" in {reason.code for reason in result.reasons}
        # Once an actual settled cash-out is present, the same family-shaped
        # topology must not suppress a genuine transit/mule alert.
        cashout = replace(
            context("settled-cashout"),
            sender_id="recipient",
            recipient_id="cashout",
            amount=1_100_000,
        )
        await engine.record_settled(cashout)
        engine.apply_transfer(cashout)
        result = await engine.evaluate(context("after-cashout"))
        assert result.decision.value == "blocked"
        assert "RECIPIENT_TRANSIT_RATIO" in {reason.code for reason in result.reasons}
        assert graph.metrics("recipient").is_hub
    finally:
        await redis.aclose()


@pytest.mark.parametrize("key_name", ["api_key", "soc_api_key"])
@pytest.mark.parametrize("value", ["", " "])
def test_configured_empty_service_keys_are_rejected(key_name: str, value: str) -> None:
    with pytest.raises(ValidationError, match="must not be empty"):
        Settings.model_validate({key_name: SecretStr(value)})


@pytest.mark.parametrize("minutes", [0, -1])
def test_cooling_duration_cannot_disable_the_hold(minutes: int) -> None:
    with pytest.raises(ValidationError):
        Settings(cooling_off_minutes=minutes)

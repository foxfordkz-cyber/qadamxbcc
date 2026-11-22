from datetime import timedelta
from decimal import Decimal

import pytest

from app.schemas.transfers import TransferEvaluateRequest
from app.services.antifraud import POST_CALL_PAYMENT_RULE, AntifraudEngine
from app.services.transfers import TransferService
from scripts.payee_followup_replay import PAIRS, replay
from tests.clock import pin_server_clock
from tests.test_antifraud import engine as engine
from tests.test_api import API, DAY, World
from tests.test_api import world as world


async def test_independent_followup_pairs() -> None:
    rows = await replay()
    decisions = {(key, fraud): (decision, score) for key, fraud, decision, score in rows}
    assert len(decisions) == len(rows) == 24
    assert {key for key, fraud, decision, _ in rows if fraud and decision == "approved"} == {
        "family-unreported-twin",
        "market-no-call-twin",
        "family-small-twin",
        "market-old-payee",
    }
    assert {key for key, fraud, decision, _ in rows if not fraud and decision != "approved"} == {
        "family-rent-twin"
    }
    assert all(decision != "blocked" for _, _, decision, _ in rows)
    for pair in PAIRS:
        if pair.fraud == pair.honest:
            assert decisions[(pair.name, True)] == decisions[(pair.name, False)]


@pytest.mark.parametrize(
    ("prior", "elapsed", "amount", "reported", "hold"),
    [
        (1_000, timedelta(hours=23, minutes=59), 120_000, True, True),
        (1_000, timedelta(days=1), 120_000, True, False),
        (1_000, timedelta(hours=1), 119_999, True, False),
        (40_000, timedelta(hours=1), 120_000, True, False),
        (1_000, timedelta(hours=1), 120_000, False, False),
    ],
)
async def test_followup_uses_bank_settlement_and_persisted_answer(
    world: World,
    monkeypatch: pytest.MonkeyPatch,
    prior: int,
    elapsed: timedelta,
    amount: int,
    reported: bool,
    hold: bool,
) -> None:
    pin_server_clock(monkeypatch, DAY - elapsed)
    first = await world.evaluate("dana", "victim", prior, occurred_at=DAY.isoformat())
    assert first["status"] == "approved"
    pin_server_clock(monkeypatch, DAY)
    result = await world.evaluate(
        "dana",
        "victim",
        amount,
        occurred_at=DAY.isoformat(),
        context={
            "call_pressure_answer": "after_call" if reported else "no_request",
            "is_new_recipient": True,
        },
    )
    assert result["status"] == ("cooling_off" if hold else "approved")
    if hold:
        assert not result["is_new_recipient"]
        reason = next(r for r in result["reasons"] if r["code"] == POST_CALL_PAYMENT_RULE)
        assert reason["evidence"]["previous_amount_kzt"] == prior
        assert reason["evidence"]["settled_count"] == 1
        assert reason["reason_ru"]
        assert reason["reason_kk"]
        detail = (await world.client.get(f"{API}/transfers/{result['transaction_id']}")).json()
        saved = next(r for r in detail["reasons"] if r["code"] == POST_CALL_PAYMENT_RULE)
        assert saved["evidence"]["previous_amount_kzt"] == prior
        assert saved["reason_kk"] == reason["reason_kk"]
        assert detail["headline_ru"] == result["headline_ru"]


async def test_preflight_reads_single_settlement_without_recording_attempt(
    world: World,
    engine: AntifraudEngine,
) -> None:
    first = await world.evaluate("dana", "victim", 2_000, occurred_at=DAY.isoformat())
    assert first["status"] == "approved"
    # The resident graph knows about a prior payment; Redis has no settled history.
    # The application still has its locked SQL observation for the ended-call arm.
    engine.graph.add_transfer(world.id("dana"), world.id("victim"), 2_000)
    req = TransferEvaluateRequest(
        sender_id=world.acc["dana"].id,
        recipient_id=world.acc["victim"].id,
        amount=Decimal("120000"),
        occurred_at=DAY,
    )
    async with world.sessions() as session:
        assert await TransferService(session, engine).should_ask_about_call(req)
    snapshot = await engine.velocity.snapshot(
        sender_id=str(req.sender_id), recipient_id=str(req.recipient_id), ts=DAY.timestamp()
    )
    assert snapshot.sender_out.count("10m") == 0

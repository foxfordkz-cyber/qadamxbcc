"""Decision and lifecycle contrasts for transfers submitted after a call."""

import hashlib
import json
import uuid
from dataclasses import replace
from decimal import Decimal

import pytest

from app.models import Transaction, TransactionStatus
from app.schemas.transfers import TransferEvaluateRequest
from app.services.antifraud import (
    NEW_PAYEE_NIGHT_RULE,
    POST_CALL_PAYMENT_RULE,
    AntifraudEngine,
    Evaluation,
    TransferContext,
)
from app.services.transfers import TransferService
from tests.test_antifraud import DAY, ctx
from tests.test_antifraud import engine as engine
from tests.test_api import API, CLEAN, NIGHT, World
from tests.test_api import world as world


@pytest.mark.parametrize(
    ("hour_utc", "amount", "avg", "known", "expected"),
    [
        (19, 75_000, 25_000, False, True),  # midnight in Almaty, exactly three averages
        (0, 75_000, 25_000, False, True),  # 05:00 local
        (1, 75_000, 25_000, False, False),  # 06:00 local
        (18, 75_000, 25_000, False, False),  # 23:00 local
        (19, 74_999, 25_000, False, False),
        (19, 75_000, 25_000, True, False),
        (19, 75_000, 0, False, False),
    ],
)
async def test_night_review_requires_all_three_signals(
    engine: AntifraudEngine,
    hour_utc: int,
    amount: int,
    avg: int,
    known: bool,
    expected: bool,
) -> None:
    if known:
        engine.graph.add_transfer("alice", "buyer", 1_000)
    tx = ctx("alice", "buyer", amount, avg=avg, at=DAY.replace(hour=hour_utc))
    result = await engine.evaluate(tx)
    matching = [r for r in result.reasons if r.code == NEW_PAYEE_NIGHT_RULE]
    assert bool(matching) == expected
    if expected:
        assert result.decision is TransactionStatus.COOLING_OFF
        assert result.score == 40
        assert matching[0].evidence["ratio"] == "3,0"
    else:
        assert result.decision is TransactionStatus.APPROVED


async def test_review_asks_if_only_an_ended_call_changes_the_decision(
    world: World, engine: AntifraudEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    payer, payee = world.acc["dana"], world.acc["scammer"]
    # The resident graph has seen a connection, but SQL records no settled payment.
    engine.graph.add_transfer(str(payer.id), str(payee.id), 1000)
    payment = TransferEvaluateRequest(
        sender_id=payer.id, recipient_id=payee.id, amount=Decimal("50000"), occurred_at=DAY
    )
    outcomes = []
    evaluate = engine.evaluate

    async def observe(context: TransferContext, *, record_attempt: bool = True) -> Evaluation:
        assert not record_attempt
        result = await evaluate(context, record_attempt=record_attempt)
        outcomes.append(
            (context.active_call, context.payment_requested_after_call, result.decision)
        )
        return result

    monkeypatch.setattr(engine, "evaluate", observe)
    async with world.sessions() as session:
        assert await TransferService(session, engine).should_ask_about_call(payment)
    assert outcomes == [
        (False, False, TransactionStatus.APPROVED),
        (True, False, TransactionStatus.APPROVED),
        (False, True, TransactionStatus.COOLING_OFF),
    ]


async def test_floor_never_increases_a_block_and_does_not_double_count_reports(
    engine: AntifraudEngine,
) -> None:
    tx = replace(
        ctx("payer", "payee", 90_000, avg=25_000, at=DAY.replace(hour=21)),
        payment_requested_after_call=True,
    )
    both = await engine.evaluate(tx, record_attempt=False)
    assert both.score == 40
    assert {r.code for r in both.reasons} >= {NEW_PAYEE_NIGHT_RULE, POST_CALL_PAYMENT_RULE}
    assert sum(r.score_delta for r in both.reasons) == 40
    flagged = replace(tx, recipient_flagged=True)
    before = await engine.evaluate(
        replace(flagged, payment_requested_after_call=False), record_attempt=False
    )
    after = await engine.evaluate(flagged, record_attempt=False)
    assert after.decision == before.decision == TransactionStatus.BLOCKED
    assert after.score == before.score


async def test_api_report_is_bound_to_first_payment_and_persists_through_review(
    world: World,
) -> None:
    report = {"payment_requested_after_call": True}
    known = await world.evaluate(
        "alice",
        "bob",
        25_000,
        occurred_at=DAY.isoformat(),
        context=report | {"is_new_recipient": True},
    )
    assert known["status"] == "approved"
    assert not known["is_new_recipient"]
    assert all(r["code"] != POST_CALL_PAYMENT_RULE for r in known["reasons"])
    unreported = await world.evaluate("dana", "victim", 25_000, occurred_at=DAY.isoformat())
    assert unreported["status"] == "approved"
    held = await world.evaluate(
        "victim",
        "dana",
        25_000,
        occurred_at=DAY.isoformat(),
        request_id=str(uuid.uuid4()),
        context=report | {"is_new_recipient": False},
    )
    assert held["status"] == "cooling_off"
    assert held["risk_score"] == 40
    assert held["is_new_recipient"]
    assert not held["context"]["active_call"]
    reason = next(r for r in held["reasons"] if r["code"] == POST_CALL_PAYMENT_RULE)
    assert reason["evidence"]["source"] == "customer_report"
    assert reason["reason_ru"]
    assert reason["reason_kk"]
    path = f"{API}/transfers/{held['transaction_id']}"
    detail = (await world.client.get(path)).json()
    assert detail["context"]["payment_requested_after_call"] is True
    assert detail["headline_ru"] == held["headline_ru"]
    early = await world.client.post(f"{path}/resolve-cooling", json={"answers": CLEAN})
    assert early.json()["status"] == "cooling_off"
    unsafe = await world.client.post(
        f"{path}/resolve-cooling",
        json={"answers": CLEAN | {"knows_recipient_personally": False}},
    )
    assert unsafe.json()["status"] == "blocked"
    assert unsafe.json()["red_flags"] == ["unknown_recipient_under_pressure"]
    assert (await world.client.get(path)).json()["red_flags"] == unsafe.json()["red_flags"]


async def test_new_night_policy_uses_settled_payee_and_clean_review_can_release(
    world: World,
) -> None:
    known = await world.evaluate(
        "alice", "bob", 120_000, occurred_at=NIGHT, context={"is_new_recipient": True}
    )
    assert known["status"] == "approved"
    assert all(r["code"] != NEW_PAYEE_NIGHT_RULE for r in known["reasons"])
    held = await world.evaluate(
        "alice", "dana", 120_000, occurred_at=NIGHT, context={"is_new_recipient": False}
    )
    assert held["is_new_recipient"]
    assert held["risk_score"] == 40
    assert any(r["code"] == NEW_PAYEE_NIGHT_RULE for r in held["reasons"])
    await world.expire_hold(held["transaction_id"])
    path = f"{API}/transfers/{held['transaction_id']}/resolve-cooling"
    final = await world.client.post(
        path, json={"answers": CLEAN | {"knows_recipient_personally": False}}
    )
    assert final.json()["status"] == "approved"


async def test_legacy_idempotency_keys_are_stable_and_positive_report_changes_payload(
    world: World,
) -> None:
    body = {
        "request_id": str(uuid.uuid4()),
        "sender_id": world.id("alice"),
        "recipient_id": world.id("bob"),
        "amount": "1000",
    }
    path = f"{API}/transfers/evaluate"
    first = (await world.client.post(path, json=body)).json()
    original = TransferEvaluateRequest.model_validate(body).model_dump(
        mode="json", exclude={"request_id"}
    )
    original["context"].pop("payment_requested_after_call")
    original["amount"] = "1000.00"
    legacy_hash = hashlib.sha256(
        json.dumps(original, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    async with world.sessions() as session:
        tx = await session.get(Transaction, uuid.UUID(body["request_id"]))
        assert tx is not None
        assert tx.request_hash == legacy_hash
        old_context = dict(tx.context_snapshot)
        old_context.pop("payment_requested_after_call")
        tx.context_snapshot = old_context
        tx.evaluation_snapshot = {**tx.evaluation_snapshot, "context": old_context}
        await session.commit()
    replay = await world.client.post(
        path, json=body | {"context": {"payment_requested_after_call": False}}
    )
    assert replay.json() == first
    conflict = await world.client.post(
        path, json=body | {"context": {"payment_requested_after_call": True}}
    )
    assert conflict.status_code == 409
    invalid = await world.client.post(
        path, json=body | {"context": {"payment_requested_after_call": "false"}}
    )
    assert invalid.status_code == 422

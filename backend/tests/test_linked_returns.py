import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import returns
from app.core.config import Settings
from app.main import create_app
from app.models import Account, PaymentReturn, Transaction, TransactionStatus
from tests.test_api import API, CLEAN, DAY, World
from tests.test_api import world as world
from tests.test_recipient_flags import resources
from tests.test_service_boundaries import SOC_KEY, TRANSFER_KEY, pilot

RETURN = {"action": "return_to_sender", "confirmed": True}
REPORT = {"action": "report_redirect", "confirmed": True}


async def payment(world: World, monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setattr(returns, "DEMO_OWNER", uuid.UUID(world.id("alice")))
    result = await world.evaluate("bob", "alice", 18500, occurred_at=DAY.isoformat())
    assert result["status"] == "approved"
    return str(result["transaction_id"])


async def test_client_consent_scope_and_receipt(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    identity = await payment(world, monkeypatch)
    other = await world.evaluate("dana", "bob", 1000, occurred_at=DAY.isoformat())
    page = (await world.client.get(f"{API}/returns/incoming")).json()["items"]
    assert len(page) == 1
    assert page[0]["original_id"] == identity
    assert page[0]["payer"]["display_name"] == "Bob T."
    assert page[0]["payer"]["iban_masked"] != world.acc["bob"].iban
    assert (
        await world.client.post(f"{API}/returns/{other['transaction_id']}", json=RETURN)
    ).status_code == 404
    url = f"{API}/returns/{identity}"
    for invalid in (
        {"action": "return_to_sender"},
        {**RETURN, "confirmed": 1},
        {**RETURN, "amount": 100},
        {**RETURN, "recipient_id": world.id("dana")},
        {**RETURN, "request_id": str(uuid.uuid4())},
    ):
        assert (await world.client.post(url, json=invalid)).status_code == 422
    receipt = await world.client.post(url, json=RETURN)
    assert receipt.status_code == 200, receipt.text
    data = receipt.json()
    assert data["refund_status"] == "approved"
    assert data["amount"] == "18500.00"
    assert (await world.client.post(url, json=RETURN)).json() == data
    async with world.sessions() as session:
        tx = await session.get(Transaction, uuid.UUID(data["refund_transaction_id"]))
        assert tx
        assert tx.sender_id == world.acc["alice"].id
        assert tx.recipient_id == world.acc["bob"].id
        assert tx.amount == Decimal("18500")
        assert tx.evaluation_snapshot["ml_score"] is not None
        assert await session.scalar(select(func.count()).select_from(Transaction)) == 3
    monkeypatch.setattr(returns, "DEMO_OWNER", world.acc["bob"].id)
    assert (
        await world.client.post(f"{API}/returns/{data['refund_transaction_id']}", json=RETURN)
    ).status_code == 404
    assert data["refund_transaction_id"] not in [
        p["original_id"]
        for p in (await world.client.get(f"{API}/returns/incoming")).json()["items"]
    ]


async def test_return_report_appeal_and_private_review(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    identity = await payment(world, monkeypatch)
    url = f"{API}/returns/{identity}"
    soc = f"{API}/soc/returns/{identity}/review"
    upheld = {"stage": "reported", "decision": "uphold", "confirmed": True}
    appeal = {"action": "appeal", "confirmed": True}
    assert (await world.client.post(url, json=REPORT)).json()["review_state"] == "reported"
    assert (await world.client.post(url, json=REPORT)).json()["review_state"] == "reported"
    assert (await world.client.post(url, json=RETURN)).status_code == 409
    assert (await world.client.get(f"{API}/soc/feed?alerts_only=true")).json()["items"][0][
        "transaction_id"
    ] == identity
    assert (await world.client.post(soc, json=upheld)).json()["can_appeal"] is True
    assert (await world.client.post(url, json=appeal)).json()["review_state"] == "appealed"
    assert (await world.client.post(soc, json=upheld)).status_code == 409
    cleared = {"stage": "appealed", "decision": "clear", "confirmed": True}
    assert (await world.client.post(soc, json=cleared)).json()["review_state"] == "cleared"
    assert (await world.client.post(soc, json=cleared)).json()["refund_transaction_id"] is None
    detail = (await world.client.get(f"{API}/transfers/{identity}")).json()
    assert {r["code"] for r in detail["reasons"] if r["code"].startswith("RETURN_")} == {
        "RETURN_REDIRECT_REPORTED",
        "RETURN_APPEAL_REQUESTED",
        "RETURN_REVIEW_CLEARED",
        "RETURN_REVIEW_UPHELD",
    }
    async with world.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Transaction)) == 1
    assert (await world.client.post(url, json=RETURN)).json()["refund_status"] == "approved"


async def test_restrict_only_disputed_credits_and_restore_spendable_after_clear(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services.demo_funds import disputed_total, posted_balance

    original = await payment(world, monkeypatch)
    owner = uuid.UUID(world.id("alice"))
    url = f"{API}/returns/{original}"
    for _ in range(2):
        assert (await world.client.post(url, json=REPORT)).status_code == 200
    async with world.sessions() as db:
        assert await disputed_total(db, owner) == Decimal("18500")
        available = (await posted_balance(db, owner)) - Decimal("18500")
    body = {
        "sender_id": str(owner),
        "recipient_id": world.id("bob"),
        "amount": str(available + Decimal("0.01")),
    }
    refused = await world.client.post(f"{API}/transfers/evaluate", json=body)
    assert refused.status_code == 409
    assert refused.json()["detail"] == "disputed_amount_reserved"
    paid = await world.evaluate("alice", "bob", 1100, occurred_at=DAY.isoformat())
    assert paid["status"] == "approved"
    action = f"{API}/soc/returns/{original}/review"
    assert (
        await world.client.post(
            action, json={"decision": "clear", "stage": "reported", "confirmed": True}
        )
    ).status_code == 200
    async with world.sessions() as db:
        assert await disputed_total(db, owner) == 0
        assert (await posted_balance(db, owner)) == available + Decimal("18500") - Decimal("1100")
    assert (await world.client.post(f"{API}/transfers/evaluate", json=body)).status_code == 200


async def previous_debit(world: World, amount: str) -> None:
    async with world.sessions() as db:
        db.add(
            Transaction(
                sender_id=world.acc["alice"].id,
                recipient_id=world.acc["dana"].id,
                amount=Decimal(amount),
                status=TransactionStatus.APPROVED,
                device_id="seed",
                created_at=DAY - timedelta(days=2),
            )
        )
        await db.commit()


async def test_recheck_available_funds_before_releasing_a_held_payment(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    incoming = await payment(world, monkeypatch)
    held = await world.evaluate(
        "alice",
        "scammer",
        900_000,
        context={"active_call": True, "from_deposit": True},
        occurred_at=DAY.isoformat(),
    )
    assert held["status"] == "cooling_off"
    await previous_debit(world, "4101000.00")
    assert (await world.client.post(f"{API}/returns/{incoming}", json=REPORT)).is_success
    await world.expire_hold(held["transaction_id"])
    path = f"{API}/transfers/{held['transaction_id']}/resolve-cooling"
    blocked = await world.client.post(path, json={"answers": CLEAN})
    assert blocked.status_code == 409
    assert blocked.json()["detail"] == "disputed_amount_reserved"
    assert (await world.client.get(f"{API}/transfers/{held['transaction_id']}")).json()[
        "status"
    ] == "cooling_off"
    assert (
        await world.client.post(
            f"{API}/soc/returns/{incoming}/review",
            json={"decision": "clear", "stage": "reported", "confirmed": True},
        )
    ).is_success
    assert (await world.client.post(path, json={"answers": CLEAN})).json()["status"] == "approved"


async def assert_concurrent_returns(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    identity = await payment(world, monkeypatch)
    result = await asyncio.gather(
        *(world.client.post(f"{API}/returns/{identity}", json=RETURN) for _ in range(6))
    )
    assert all(r.status_code == 200 for r in result)
    assert len({r.json()["refund_transaction_id"] for r in result}) == 1
    async with world.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Transaction)) == 2
        assert await session.scalar(select(func.count()).select_from(PaymentReturn)) == 1


async def test_concurrent_retries(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    await assert_concurrent_returns(world, monkeypatch)


async def test_failed_commit_rolls_back_both_records(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    identity = await payment(world, monkeypatch)
    url = f"{API}/returns/{identity}"

    async def unavailable(self: AsyncSession) -> None:
        raise RuntimeError("test commit unavailable")

    with monkeypatch.context() as patch:
        patch.setattr(AsyncSession, "commit", unavailable)
        with pytest.raises(RuntimeError, match="test commit unavailable"):
            await world.client.post(url, json=RETURN)
    assert (await world.client.get(url)).json()["refund_transaction_id"] is None
    async with world.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Transaction)) == 1
    assert (await world.client.post(url, json=RETURN)).json()["refund_status"] == "approved"


@pytest.mark.parametrize(
    "status",
    [TransactionStatus.BLOCKED, TransactionStatus.COOLING_OFF, TransactionStatus.CANCELLED],
)
async def test_ineligible_outcome(
    world: World, monkeypatch: pytest.MonkeyPatch, status: TransactionStatus
) -> None:
    identity = await payment(world, monkeypatch)
    async with world.sessions() as session:
        original = await session.get(Transaction, uuid.UUID(identity))
        assert original
        original.status = status
        await session.commit()
    assert (await world.client.get(f"{API}/returns/incoming")).json()["items"] == []
    assert (await world.client.post(f"{API}/returns/{identity}", json=RETURN)).status_code == 404


async def test_settlement_time_and_future_exclusion(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    identity = await payment(world, monkeypatch)
    url = f"{API}/returns/{identity}"
    now = datetime.now(UTC)
    async with world.sessions() as session:
        tx = await session.get(Transaction, uuid.UUID(identity))
        assert tx
        tx.created_at = now - timedelta(minutes=35)
        tx.resolved_at = now + timedelta(minutes=5)
        await session.commit()
    assert (await world.client.get(url)).status_code == 404
    assert (await world.client.post(url, json=RETURN)).status_code == 404
    async with world.sessions() as session:
        tx = await session.get(Transaction, uuid.UUID(identity))
        assert tx
        tx.resolved_at = now
        await session.commit()
    assert datetime.fromisoformat((await world.client.get(url)).json()["received_at"]) == now


async def test_review_role_and_pilot_gate(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    identity = await payment(world, monkeypatch)
    url = f"{API}/returns/{identity}"
    soc_url = f"{API}/soc/returns/{identity}/review"
    employee = {"X-BCC-SOC-Key": SOC_KEY}
    client = {"X-BCC-API-Key": TRANSFER_KEY}
    body = {"decision": "clear", "stage": "reported", "confirmed": True}
    for settings in (
        Settings.model_validate(
            {"environment": "demo", "api_key": TRANSFER_KEY, "soc_api_key": SOC_KEY}
        ),
        pilot(),
    ):
        app = create_app(settings)
        app.state.resources = resources(world)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as api:
            assert (await api.get(url)).status_code == 401
            for headers in ({}, client, {"X-BCC-SOC-Key": TRANSFER_KEY}):
                assert (await api.post(soc_url, json=body, headers=headers)).status_code == 401
            if settings.environment == "pilot":
                assert (await api.get(url, headers=client)).status_code == 404
                assert (await api.post(url, json=RETURN, headers=client)).status_code == 404
                assert (await api.post(soc_url, json=body, headers=employee)).status_code == 404
            else:
                assert (await api.post(url, json=REPORT, headers=client)).status_code == 200
                assert (await api.post(soc_url, json=body, headers=employee)).json()[
                    "review_state"
                ] == "cleared"
                detail = (await api.get(f"{API}/transfers/{identity}", headers=client)).json()
                event = next(r for r in detail["reasons"] if r["code"] == "RETURN_REVIEW_CLEARED")
                assert event["evidence"]["actor"].startswith("soc_service:")
                assert SOC_KEY not in str(event)


async def test_original_payer_risk_rechecked(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    identity = await payment(world, monkeypatch)
    async with world.sessions() as session:
        payer = await session.get(Account, world.acc["bob"].id)
        assert payer
        payer.is_flagged = True
        payer.flag_version += 1
        await session.commit()
    url = f"{API}/returns/{identity}"
    data = (await world.client.post(url, json=RETURN)).json()
    assert data["refund_status"] == "blocked"
    assert (await world.client.post(url, json=RETURN)).json() == data


async def test_active_hold_follows_return_and_cancel_replay_keeps_same_id(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(returns, "DEMO_OWNER", world.acc["alice"].id)
    incoming = await world.evaluate("scammer", "alice", 1200, occurred_at=DAY.isoformat())
    assert incoming["status"] == "approved"
    first = await world.evaluate(
        "alice",
        "scammer",
        900000,
        context={"active_call": True, "from_deposit": True},
        occurred_at=DAY.isoformat(),
    )
    assert first["status"] == "cooling_off"
    url = f"{API}/returns/{incoming['transaction_id']}"
    result = (await world.client.post(url, json=RETURN)).json()
    assert result["refund_status"] == "cooling_off"
    refund_id = result["refund_transaction_id"]
    cancelled = await world.client.post(f"{API}/transfers/{refund_id}/cancel", json={})
    assert cancelled.json()["status"] == "cancelled"
    replay = (await world.client.post(url, json=RETURN)).json()
    assert replay["refund_transaction_id"] == refund_id
    assert replay["refund_status"] == "cancelled"

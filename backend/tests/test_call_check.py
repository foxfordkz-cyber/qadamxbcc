"""«Банк мне звонит?»: the bank's own outbound log answers, and «no» raises risk."""

import uuid

import fakeredis
import pytest
from httpx import ASGITransport, AsyncClient
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.resources import Resources
from app.main import create_app
from app.services.call_check import CallCheckService
from tests import test_api
from tests.test_api import API, CLEAN, World

# Same seeded accounts and app as the main API tests.
world = test_api.world


async def _check(world: World, customer: str) -> dict[str, object]:
    resp = await world.client.post(f"{API}/call-check", json={"customer_id": world.id(customer)})
    assert resp.status_code == 200, resp.text
    data: dict[str, object] = resp.json()
    return data


async def test_bank_is_not_calling_raises_risk_on_the_transfer(world: World) -> None:
    check = await _check(world, "victim")
    assert check["verified"] is False
    assert "В журнале нет" in str(check["message_ru"])
    assert check["started_at"] is None
    assert check["simulated_log"] is True

    data = await world.evaluate(
        "victim",
        "scammer",
        50_000,
        context={"active_call": True, "bank_call_check_id": check["check_id"]},
    )
    codes = {r["code"] for r in data["reasons"]}
    assert "BANK_CALL_DENIED" in codes
    assert data["status"] == "cooling_off"
    assert data["context"]["bank_call_check_id"] == check["check_id"]
    denied = next(r for r in data["reasons"] if r["code"] == "BANK_CALL_DENIED")
    assert "в журнале банка" in denied["reason_ru"]


async def test_unavailable_log_does_not_report_a_negative_match(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def unavailable(self: CallCheckService, customer_id: uuid.UUID) -> None:
        raise RedisConnectionError("unavailable")

    monkeypatch.setattr(CallCheckService, "check", unavailable)
    response = await world.client.post(
        f"{API}/call-check", json={"customer_id": world.id("victim")}
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "call_log_unavailable"


async def test_same_transfer_without_the_check_has_no_bank_reason(world: World) -> None:
    data = await world.evaluate("victim", "scammer", 50_000, context={"active_call": True})
    assert "BANK_CALL_DENIED" not in {r["code"] for r in data["reasons"]}


async def test_real_bank_call_is_confirmed_and_never_lowers_risk(world: World) -> None:
    started = await world.client.post(
        f"{API}/call-check/demo/bank-call", json={"customer_id": world.id("dana")}
    )
    assert started.status_code == 200, started.text
    check = await _check(world, "dana")
    assert check["verified"] is True
    assert check["employee_name"] == "Асем Нурланова"
    assert "В журнале есть исходящий звонок" in str(check["message_ru"])
    assert isinstance(check["started_at"], str)
    assert isinstance(check["checked_at"], str)
    assert check["started_at"] <= check["checked_at"]

    data = await world.evaluate(
        "dana",
        "scammer",
        50_000,
        context={"active_call": True, "bank_call_check_id": check["check_id"]},
    )
    codes = {r["code"] for r in data["reasons"]}
    assert "BANK_CALL_DENIED" not in codes
    assert "ACTIVE_CALL" in codes
    assert data["bank_call_evidence"] == {
        "outbound_call_listed": True,
        "checked_at": check["checked_at"],
    }


async def test_a_check_cannot_be_reused_by_another_customer(world: World) -> None:
    check = await _check(world, "victim")
    data = await world.evaluate(
        "alice",
        "bob",
        25_000,
        context={"active_call": True, "bank_call_check_id": check["check_id"]},
    )
    assert "BANK_CALL_DENIED" not in {r["code"] for r in data["reasons"]}
    assert "bank_call_evidence" not in data


async def test_unknown_check_and_unknown_customer(world: World) -> None:
    data = await world.evaluate(
        "victim",
        "scammer",
        50_000,
        context={"active_call": True, "bank_call_check_id": str(uuid.uuid4())},
    )
    assert "BANK_CALL_DENIED" not in {r["code"] for r in data["reasons"]}
    resp = await world.client.post(f"{API}/call-check", json={"customer_id": str(uuid.uuid4())})
    assert resp.status_code == 404


async def test_released_hold_keeps_the_banks_answer(world: World) -> None:
    check = await _check(world, "victim")
    data = await world.evaluate(
        "victim",
        "scammer",
        50_000,
        context={"active_call": True, "bank_call_check_id": check["check_id"]},
    )
    await world.expire_hold(data["transaction_id"])
    resp = await world.client.post(
        f"{API}/transfers/{data['transaction_id']}/resolve-cooling", json={"answers": CLEAN}
    )
    assert resp.status_code == 200, resp.text
    assert "BANK_CALL_DENIED" in {r["code"] for r in resp.json()["reasons"]}


async def test_demo_bank_call_is_closed_outside_the_demo(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    redis = fakeredis.FakeAsyncRedis()
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:", allow_demo_overrides=False)
    resources = Resources.build(settings, session_factory=session_factory, redis=redis)
    app = create_app(settings, resources)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                f"{API}/call-check/demo/bank-call", json={"customer_id": str(uuid.uuid4())}
            )
    assert resp.status_code == 404
    await redis.aclose()

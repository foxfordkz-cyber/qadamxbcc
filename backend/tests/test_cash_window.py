from datetime import timedelta
from typing import Any, Literal
from uuid import UUID, uuid4

import fakeredis
import pytest
from fastapi import HTTPException
from httpx import AsyncClient

from app.db.base import utcnow
from app.mobile_gateway.cash_window import CashRequest, cash_action
from tests.test_mobile_gateway import ADMIN_CODE, PLATFORM_CODE, login
from tests.test_mobile_gateway import mobile_world as mobile_world


async def test_cash_call_window_retries_ownership_and_normal_control() -> None:
    redis = fakeredis.FakeAsyncRedis()
    owner, other, now = uuid4(), uuid4(), utcnow()
    body = CashRequest(id=uuid4(), amount_kzt=25000, caller_requested_cash=True)
    try:
        held = await cash_action(redis, owner, "start", body.id, body, now)
        assert held.until == now + timedelta(minutes=15)
        assert await cash_action(redis, owner, "start", body.id, body, now) == held
        attempts: list[tuple[UUID, Literal["confirm", "cancel"], int]] = [
            (owner, "confirm", 409),
            (other, "cancel", 404),
        ]
        for person, action, status in attempts:
            with pytest.raises(HTTPException) as error:
                await cash_action(redis, person, action, body.id, None, now)
            assert error.value.status_code == status
        clean = body.model_copy(update={"id": uuid4(), "caller_requested_cash": False})
        with pytest.raises(HTTPException):
            await cash_action(redis, owner, "start", clean.id, clean, now)
        assert (
            await cash_action(redis, owner, "confirm", body.id, None, now + timedelta(minutes=15))
        ).state == "completed"
        assert (await cash_action(redis, owner, "start", clean.id, clean, now)).state == "ready"
        assert (await cash_action(redis, owner, "cancel", clean.id, None, now)).state == "cancelled"
        with pytest.raises(HTTPException):
            await cash_action(redis, owner, "confirm", clean.id, None, now)
    finally:
        await redis.aclose()


async def test_atm_wallet_entry_is_owner_scoped(mobile_world: tuple[AsyncClient, Any]) -> None:
    http, _ = mobile_world
    path = "/mobile/v1/wallet/cash"
    body = {"id": str(uuid4()), "amount_kzt": 25000, "caller_requested_cash": True}
    assert (await http.get(path)).status_code == 401
    for code in (ADMIN_CODE, PLATFORM_CODE):
        assert (
            await http.post(path, json=body, headers=await login(http, code))
        ).status_code == 403
    headers = await login(http)
    assert (await http.get(path, headers=headers)).json() is None
    started = await http.post(path, json=body, headers=headers)
    assert started.status_code == 200
    assert (await http.get(path, headers=headers)).json() == started.json()
    key = path + "/" + str(body["id"])
    assert (await http.post(key + "/confirm", headers=headers)).status_code == 409
    assert (await http.post(key + "/cancel", headers=headers)).json()["state"] == "cancelled"
    assert (await http.get(path, headers=headers)).json() is None

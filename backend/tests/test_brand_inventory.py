from datetime import timedelta
from typing import Any

import fakeredis
import pytest
from fastapi import HTTPException
from httpx import AsyncClient

from app.db.base import utcnow
from app.mobile_gateway.brand_inventory import Observation, inventory
from tests.test_mobile_gateway import ADMIN_CODE, PLATFORM_CODE, login
from tests.test_mobile_gateway import mobile_world as mobile_world


async def test_inventory_roles_idempotence_and_official_domains(
    mobile_world: tuple[AsyncClient, Any],
) -> None:
    http, _ = mobile_world
    path = "/mobile/v1/wallet/brand-reports"
    owner, admin, platform = (
        await login(http),
        await login(http, ADMIN_CODE),
        await login(http, PLATFORM_CODE),
    )
    item = {"indicator": "Review-Demo.example", "basis": "claims_bank"}
    for denied in (owner, platform):
        assert (await http.post(path, headers=denied, json=item)).status_code == 403
    assert (await http.get(path)).status_code == 401
    first = await http.post(path, headers=admin, json=item)
    assert first.status_code == 200
    assert first.json()[0]["indicator"] == "review-demo.example"
    assert (await http.post(path, headers=admin, json=item)).json() == first.json()
    for invalid in (
        "WWW.BCC.KZ.",
        "https://m.bcc.kz/",
        "https://t.me/BankCenterCredit_bot",
        "127.0.0.1",
        "https://bcc.kz@foo.example",
        "https://foo.example/with/private/details",
    ):
        assert (
            await http.post(path, headers=admin, json={**item, "indicator": invalid})
        ).status_code == 422
    assert (
        await http.post(path, headers=admin, json={**item, "indicator": "@synthetic_claim_example"})
    ).status_code == 200


async def test_inventory_expires_with_no_new_observations() -> None:
    redis = fakeredis.FakeAsyncRedis()
    now = utcnow()
    try:
        assert await inventory(
            redis, now, Observation(indicator="fixture.example", basis="asks_for_code")
        )
        assert await inventory(redis, now + timedelta(days=31)) == []
        with pytest.raises(HTTPException):
            await inventory(redis, now, Observation(indicator="t.me/", basis="claims_bank"))
    finally:
        await redis.aclose()

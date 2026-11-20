import uuid
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.models import Transaction, TransactionStatus
from app.services import recipient_flags
from tests.test_api import API, DAY, World
from tests.test_api import world as world
from tests.test_recipient_flags import command, flag_path, resources
from tests.test_service_boundaries import SOC_KEY, TRANSFER_KEY, pilot


async def test_flag_lookback_orders_ties_and_only_exposes_prior_settled_incoming_kzt(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(recipient_flags, "utcnow", lambda: DAY)
    endpoint = f"{API}/soc/recipients/{world.id('bob')}/prior-receipts"
    query: dict[str, str | int] = {"version": 1, "days": 1}

    def transfer(
        i: int,
        recipient: str = "bob",
        sender: str = "alice",
        when: datetime = DAY - timedelta(hours=1),
        status: TransactionStatus = TransactionStatus.APPROVED,
        resolved: datetime | None = None,
        currency: str = "KZT",
    ) -> Transaction:
        return Transaction(
            id=uuid.UUID(int=i),
            sender_id=world.acc[sender].id,
            recipient_id=world.acc[recipient].id,
            created_at=when,
            resolved_at=resolved,
            amount=Decimal("123.45"),
            currency=currency,
            status=status,
            device_id="test-device",
        )

    async with world.sessions() as session:
        session.add_all(
            [transfer(i) for i in range(1, 22)]
            + [
                transfer(31, recipient="dana"),
                transfer(32, sender="bob"),
                transfer(33, status=TransactionStatus.BLOCKED),
                transfer(34, currency="USD"),
                transfer(35, when=DAY - timedelta(days=2)),
                transfer(36, when=DAY + timedelta(hours=1)),
                transfer(37, resolved=DAY + timedelta(minutes=1)),
                transfer(38, status=TransactionStatus.COOLING_OFF),
                transfer(39, status=TransactionStatus.CANCELLED),
            ]
        )
        await session.commit()
    assert (await world.client.get(endpoint, params=query)).status_code == 409
    await world.client.post(flag_path(world), json=command(True, 0))
    response = await world.client.get(endpoint, params=query)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    first = response.json()
    assert [uuid.UUID(x["transaction_id"]).int for x in first["items"]] == list(range(21, 1, -1))
    assert first["items"][0]["amount"] == "123.45"
    assert set(first["items"][0]) == {
        "amount",
        "sender_ref",
        "settled_at",
        "status",
        "transaction_id",
    }
    assert first["items"][0]["sender_ref"] == world.acc["alice"].id.hex[-8:]
    second = (
        await world.client.get(endpoint, params={**query, "cursor": first["next_cursor"]})
    ).json()
    assert [uuid.UUID(x["transaction_id"]).int for x in second["items"]] == [1]
    assert second["next_cursor"] is None
    assert (
        await world.client.get(endpoint, params={**query, "cursor": str(uuid.UUID(int=31))})
    ).status_code == 422
    assert (await world.client.get(endpoint, params={**query, "days": 31})).status_code == 422
    await world.client.post(flag_path(world), json=command(False, 1))
    await world.client.post(flag_path(world), json=command(True, 2))
    assert (
        await world.client.get(endpoint, params={**query, "cursor": first["next_cursor"]})
    ).status_code == 409


async def test_lookback_requires_soc_key_in_pilot(world: World) -> None:
    app = create_app(pilot())
    app.state.resources = resources(world)
    endpoint = f"{API}/soc/recipients/{world.id('bob')}/prior-receipts?version=1"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for headers in ({}, {"X-BCC-API-Key": TRANSFER_KEY}):
            assert (await client.get(endpoint, headers=headers)).status_code == 401
        assert (await client.get(endpoint, headers={"X-BCC-SOC-Key": SOC_KEY})).status_code == 409

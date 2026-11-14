import asyncio
import os
import uuid

import pytest
from sqlalchemy import func, select

from app.integrations.models import ContactNotification, IntegrationAudit
from tests.integrations.conftest import IntegrationWorld

ROOT = "/api/v1/trusted-contacts"


@pytest.mark.skipif(
    not os.getenv("BCC_TEST_DATABASE_URL"), reason="PostgreSQL account locks required"
)
async def test_circle_concurrent_invites_respect_limit(iw: IntegrationWorld) -> None:
    responses = await asyncio.gather(
        *(iw.client.post(ROOT, headers=iw.auth(), json={"owner_consent": True}) for _ in range(5))
    )
    assert sorted(r.status_code for r in responses) == [201, 201, 201, 409, 409]


async def test_circle_three_independent_contacts_no_fanout(iw: IntegrationWorld) -> None:
    ids = [await iw.verified() for _ in range(3)]
    full = await iw.client.post(ROOT, headers=iw.auth(), json={"owner_consent": True})
    assert full.status_code == 409
    assert full.json()["detail"] == "contact_limit_reached"
    queued = await iw.queue(ids[1])
    assert await iw.deliver()
    assert len(iw.adapter.messages) == 1
    assert uuid.UUID(str(queued["id"])) in iw.adapter.messages
    await iw.client.delete(f"{ROOT}/{ids[0]}", headers=iw.auth())
    assert (
        await iw.client.post(ROOT, headers=iw.auth(), json={"owner_consent": True})
    ).status_code == 201


async def test_circle_preferences_rechecked_before_delivery(iw: IntegrationWorld) -> None:
    cid = await iw.verified()
    queued = await iw.queue(cid)
    body = {"alias": "Demo contact", "notifications_enabled": False, "language": "kk"}
    path = f"{ROOT}/{cid}/preferences"
    first = await iw.client.patch(path, headers=iw.auth(), json=body)
    assert first.status_code == 200
    assert (await iw.client.patch(path, headers=iw.auth(), json=body)).json() == first.json()
    assert await iw.deliver()
    assert not iw.adapter.messages
    async with iw.factory() as session:
        row = await session.get(ContactNotification, uuid.UUID(str(queued["id"])))
        assert row is not None
        assert row.state == "DELIVERY_FAILED"
        assert row.error_code == "notifications_disabled"
        assert (
            await session.scalar(
                select(func.count())
                .select_from(IntegrationAudit)
                .where(
                    IntegrationAudit.resource_id == uuid.UUID(cid),
                    IntegrationAudit.event == "CONTACT_PREFERENCES_UPDATED",
                )
            )
            == 1
        )
    await iw.client.delete(f"{ROOT}/{cid}", headers=iw.auth())
    after = await iw.client.patch(
        path, headers=iw.auth(), json={**body, "notifications_enabled": True}
    )
    assert after.status_code == 409


@pytest.mark.parametrize(
    ("alias", "expected"), [("x" * 41, 422), ("bad\nalias", 422), ("Normal", 200)]
)
async def test_circle_preferences_validation_and_owner(
    iw: IntegrationWorld, alias: str, expected: int
) -> None:
    cid = await iw.verified()
    path = f"{ROOT}/{cid}/preferences"
    body = {"alias": alias, "notifications_enabled": True, "language": "ru"}
    response = await iw.client.patch(path, headers=iw.auth(), json=body)
    assert response.status_code == expected
    body["alias"] = "Normal"
    assert (
        await iw.client.patch(path, headers=iw.auth(subject=iw.recipient.id), json=body)
    ).status_code == 404
    assert (await iw.client.patch(path, headers=iw.auth("soc"), json=body)).status_code == 403

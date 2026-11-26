"""Persistent Fake contacts must not capture a newly enabled live advisory channel."""

from datetime import timedelta
from typing import Any, cast

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.base import utcnow
from app.integrations.config import IntegrationSettings
from app.integrations.models import ContactNotification
from app.integrations.telegram.schemas import NotificationState
from tests.test_mobile_gateway import OWNER, call_tx, login
from tests.test_mobile_gateway import mobile_world as mobile_world
from tests.test_second_confirmation import contact


@pytest.mark.parametrize("available", [True, False])
async def test_live_advisory_skips_old_fake_contact_and_deduplicates(
    mobile_world: tuple[AsyncClient, Any],
    session_factory: async_sessionmaker[AsyncSession],
    available: bool,
) -> None:
    client, _ = mobile_world
    app = cast(Any, client._transport).app
    mobile_integrations: IntegrationSettings = (
        app.state.core_client._transport.app.state.integration_settings
    )
    auth = await login(client)
    txid = await call_tx(client, auth)
    before = (await client.get("/mobile/v1/account", headers=auth)).json()["balance"]
    await client.post("/mobile/v1/protection/family", headers=auth, json={"action": "enable"})
    async with session_factory() as db:
        old = contact(OWNER, "510008")
        old.created_at = utcnow() - timedelta(days=1)
        new = contact(OWNER, "880001")
        new.notifications_enabled = available
        db.add_all([old, new])
        await db.commit()
        expected = new.id
    # Exercise the selection after changing configuration; no hosted poller/network in tests.
    mobile_integrations.telegram_mode = "test"
    mobile_integrations.telegram_allowed_chat_ids = [880001]
    for _ in range(2):
        reply = await client.post(f"/mobile/v1/protection/{txid}/notify", headers=auth)
        assert reply.status_code == (200 if available else 409), reply.text
    async with session_factory() as db:
        notices = list(await db.scalars(select(ContactNotification)))
        assert len(notices) == int(available)
        if available:
            assert notices[0].contact_id == expected
            assert notices[0].state == NotificationState.QUEUED
            # An uncertain old delivery must not become a resend/fan-out after this fix.
            notices[0].state = NotificationState.FAILED
            notices[0].error_code = "delivery_failed_or_uncertain"
            await db.commit()
    if available:
        await client.post(f"/mobile/v1/protection/{txid}/notify", headers=auth)
        async with session_factory() as db:
            notices = list(await db.scalars(select(ContactNotification)))
            assert len(notices) == 1
            assert notices[0].state == NotificationState.FAILED
    assert (await client.get("/mobile/v1/account", headers=auth)).json()["balance"] == before
    assert (await client.get(f"/mobile/v1/api/transfers/{txid}", headers=auth)).json()[
        "status"
    ] == "cooling_off"

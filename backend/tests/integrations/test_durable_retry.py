import asyncio
import uuid
from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app.db.base import utcnow
from app.integrations.models import ContactNotification, IntegrationAudit
from app.integrations.telegram.adapter import RejectedDeliveryError
from app.integrations.telegram.worker import deliver_one
from tests.integrations.conftest import IntegrationWorld


async def make_due(iw: IntegrationWorld, notification: dict[str, object]) -> None:
    async with iw.factory() as session:
        row = await session.get(ContactNotification, uuid.UUID(str(notification["id"])))
        assert row is not None
        row.next_attempt_at = utcnow() - timedelta(seconds=1)
        await session.commit()


async def test_long_rejection_is_durable_and_recovers_without_duplicate(
    iw: IntegrationWorld,
) -> None:
    row = await iw.queue(await iw.verified())
    rejected = AsyncMock()
    rejected.send.side_effect = RejectedDeliveryError(120)
    async with asyncio.timeout(2):
        assert await deliver_one(iw.factory, rejected, iw.cfg)
    async with iw.factory() as session:
        saved = await session.get(ContactNotification, uuid.UUID(str(row["id"])))
        assert saved is not None
        assert saved.state == "NOTIFICATION_QUEUED"
        assert saved.claimed_at is None
        assert saved.attempts == 1
        assert saved.next_attempt_at is not None
        assert saved.next_attempt_at > utcnow()
    assert not await iw.deliver()  # a restarted worker cannot send before due time
    await make_due(iw, row)
    assert await iw.deliver()
    assert not await iw.deliver()
    assert len(iw.adapter.messages) == 1
    async with iw.factory() as session:
        saved = await session.get(ContactNotification, uuid.UUID(str(row["id"])))
        assert saved is not None
        assert saved.attempts == 2
        assert saved.error_code is None
        events = list(
            await session.scalars(
                select(IntegrationAudit.event).where(IntegrationAudit.resource_id == saved.id)
            )
        )
        assert events.count("NOTIFICATION_RETRY") == 1
        assert events.count("NOTIFICATION_SENT") == 1


@pytest.mark.parametrize("guard", ["revoke", "expiry", "resolved"])
async def test_delayed_retry_rechecks_consent_deadline_and_core(
    iw: IntegrationWorld, guard: str
) -> None:
    from app.models import Transaction, TransactionStatus

    contact = await iw.verified()
    row = await iw.queue(contact)
    rejected = AsyncMock()
    rejected.send.side_effect = RejectedDeliveryError(120)
    await deliver_one(iw.factory, rejected, iw.cfg)
    if guard == "revoke":
        assert (
            await iw.client.delete(f"/api/v1/trusted-contacts/{contact}", headers=iw.auth())
        ).status_code == 200
    else:
        async with iw.factory() as session:
            saved = await session.get(ContactNotification, uuid.UUID(str(row["id"])))
            assert saved is not None
            if guard == "expiry":
                saved.expires_at = utcnow() - timedelta(seconds=1)
            else:
                tx = await session.get(Transaction, saved.transaction_id)
                assert tx is not None
                tx.status = TransactionStatus.BLOCKED
            await session.commit()
    await make_due(iw, row)
    await iw.deliver()
    assert not iw.adapter.messages
    async with iw.factory() as session:
        saved = await session.get(ContactNotification, uuid.UUID(str(row["id"])))
        assert saved is not None
        assert saved.state == ("CONTACT_REVOKED" if guard == "revoke" else "NOTIFICATION_EXPIRED")


async def test_rejections_are_bounded_across_worker_restarts(iw: IntegrationWorld) -> None:
    row = await iw.queue(await iw.verified())
    rejected = AsyncMock()
    rejected.send.side_effect = RejectedDeliveryError(30)
    for _ in range(3):
        assert await deliver_one(iw.factory, rejected, iw.cfg)
        await make_due(iw, row)
    assert not await deliver_one(iw.factory, rejected, iw.cfg)
    assert rejected.send.await_count == 3
    async with iw.factory() as session:
        saved = await session.get(ContactNotification, uuid.UUID(str(row["id"])))
        assert saved is not None
        assert saved.error_code == "retry_exhausted"
        assert saved.state == "DELIVERY_FAILED"


async def test_retry_after_deadline_is_terminal_without_sleep(iw: IntegrationWorld) -> None:
    row = await iw.queue(await iw.verified())
    rejected = AsyncMock()
    rejected.send.side_effect = RejectedDeliveryError(3600)
    async with asyncio.timeout(2):
        await deliver_one(iw.factory, rejected, iw.cfg)
    assert not await iw.deliver()
    async with iw.factory() as session:
        saved = await session.get(ContactNotification, uuid.UUID(str(row["id"])))
        assert saved is not None
        assert saved.state == "NOTIFICATION_EXPIRED"


async def test_crash_after_retry_claim_does_not_resend(iw: IntegrationWorld) -> None:
    row = await iw.queue(await iw.verified())
    rejected = AsyncMock()
    rejected.send.side_effect = RejectedDeliveryError(20)
    await deliver_one(iw.factory, rejected, iw.cfg)
    async with iw.factory() as session:
        saved = await session.get(ContactNotification, uuid.UUID(str(row["id"])))
        assert saved is not None
        saved.next_attempt_at = None
        saved.claimed_at = utcnow() - timedelta(seconds=31)
        saved.attempts = 2
        await session.commit()
    assert not await iw.deliver()
    assert not iw.adapter.messages
    async with iw.factory() as session:
        saved = await session.get(ContactNotification, uuid.UUID(str(row["id"])))
        assert saved is not None
        assert saved.error_code == "delivery_uncertain"

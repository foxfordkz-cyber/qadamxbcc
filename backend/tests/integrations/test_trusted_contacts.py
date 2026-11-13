import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from app.db.base import utcnow
from app.integrations.models import ContactNotification, IntegrationAudit, TrustedContact
from app.integrations.telegram.schemas import NotificationState
from app.models import Transaction, TransactionStatus
from tests.integrations.conftest import IntegrationWorld

ROOT = "/api/v1/trusted-contacts"


async def test_no_contact(iw: IntegrationWorld) -> None:
    response = await iw.client.get(ROOT, headers=iw.auth())
    assert response.json() == {"state": "CONTACT_NOT_CONFIGURED", "contacts": []}


@pytest.mark.parametrize("consent", [False, None])
async def test_owner_consent_required(iw: IntegrationWorld, consent: bool | None) -> None:
    response = await iw.client.post(ROOT, headers=iw.auth(), json={"owner_consent": consent})
    assert response.status_code == 422


async def test_one_time_invite_and_contact_consent(iw: IntegrationWorld) -> None:
    invitation = await iw.invite()
    assert "telegram_chat_id" not in str(invitation)
    body = {"kind": "start", "chat_id": 123, "reference": invitation["invitation_token"]}
    bound = await iw.client.post(
        ROOT + "/simulator/update", headers=iw.auth("simulator"), json=body
    )
    assert bound.json()["state"] == "CONTACT_PENDING_CONSENT"
    replay = await iw.client.post(
        ROOT + "/simulator/update", headers=iw.auth("simulator"), json=body
    )
    assert replay.status_code == 409
    tx = await iw.transfer()
    queue = await iw.client.post(
        f"{ROOT}/transactions/{tx['transaction_id']}/notifications",
        headers=iw.auth(),
        json={"contact_id": bound.json()["resource_id"]},
    )
    assert queue.status_code == 409
    async with iw.factory() as session:
        rows = (await session.scalars(select(TrustedContact))).all()
        assert rows[0].invitation_hash is None
        assert rows[0].contact_consented_at is None


async def test_expired_invite(iw: IntegrationWorld) -> None:
    invite = await iw.invite()
    async with iw.factory() as session:
        row = await session.scalar(select(TrustedContact))
        assert row
        row.invitation_expires_at = utcnow() - timedelta(seconds=1)
        await session.commit()
    response = await iw.client.post(
        ROOT + "/simulator/update",
        headers=iw.auth("simulator"),
        json={"kind": "start", "chat_id": 123, "reference": invite["invitation_token"]},
    )
    assert response.status_code == 409


async def test_verified_duplicate_notification_and_audit(iw: IntegrationWorld) -> None:
    contact = await iw.verified()
    row = await iw.queue(contact)
    duplicate = await iw.client.post(
        f"{ROOT}/transactions/{row['transaction_id']}/notifications",
        headers=iw.auth(),
        json={"contact_id": contact},
    )
    assert duplicate.json()["id"] == row["id"]
    assert await iw.deliver()
    assert not await iw.deliver()
    assert len(iw.adapter.messages) == 1
    async with iw.factory() as session:
        assert await session.scalar(select(func.count()).select_from(ContactNotification)) == 1
        assert (
            await session.scalar(
                select(func.count())
                .select_from(IntegrationAudit)
                .where(IntegrationAudit.event == "NOTIFICATION_QUEUED")
            )
            == 1
        )
    history = await iw.client.get(f"{ROOT}/notifications/{row['id']}/history", headers=iw.auth())
    assert [r["event"] for r in history.json()] == ["NOTIFICATION_QUEUED", "NOTIFICATION_SENT"]


async def test_approved_transfer_not_queued(iw: IntegrationWorld) -> None:
    contact = await iw.verified()
    tx = await iw.transfer(cooling=False)
    response = await iw.client.post(
        f"{ROOT}/transactions/{tx['transaction_id']}/notifications",
        headers=iw.auth(),
        json={"contact_id": contact},
    )
    assert response.status_code == 409
    assert not await iw.deliver()


@pytest.mark.parametrize("failure", ["adapter", "expiry", "resolved", "revoke", "disabled"])
async def test_delivery_guards(iw: IntegrationWorld, failure: str) -> None:
    contact = await iw.verified()
    queued = await iw.queue(contact)
    if failure == "adapter":
        iw.adapter.fail = True
    elif failure == "disabled":
        iw.cfg.telegram_mode = "disabled"
    elif failure == "revoke":
        response = await iw.client.delete(f"{ROOT}/{contact}", headers=iw.auth())
        assert response.status_code == 200
    else:
        async with iw.factory() as session:
            row = await session.get(ContactNotification, uuid.UUID(str(queued["id"])))
            assert row
            if failure == "expiry":
                row.expires_at = utcnow() - timedelta(seconds=1)
            else:
                tx = await session.get(Transaction, row.transaction_id)
                assert tx
                tx.status = TransactionStatus.BLOCKED
            await session.commit()
    await iw.deliver()
    assert not iw.adapter.messages
    async with iw.factory() as session:
        row = await session.get(ContactNotification, uuid.UUID(str(queued["id"])))
        assert row
        expected = {
            "adapter": NotificationState.FAILED,
            "expiry": NotificationState.EXPIRED,
            "resolved": NotificationState.EXPIRED,
            "revoke": NotificationState.REVOKED,
            "disabled": NotificationState.QUEUED,
        }
        assert row.state == expected[failure]


async def callback(
    client: AsyncClient,
    iw: IntegrationWorld,
    reference: str,
    action: str,
    chat: int = 123,
    message_id: str | None = None,
) -> int:
    response = await client.post(
        ROOT + "/simulator/update",
        headers=iw.auth("simulator"),
        json={"kind": action, "chat_id": chat, "reference": reference, "message_id": message_id},
    )
    return response.status_code


async def test_callbacks_are_advisory_monotonic_and_idempotent(iw: IntegrationWorld) -> None:
    queued = await iw.queue(await iw.verified())
    await iw.deliver()
    reference = str(queued["id"])
    async with iw.factory() as session:
        row = await session.get(ContactNotification, uuid.UUID(reference))
        assert row
        message_id = row.message_id
    for action in ("ack", "ack", "suspect", "ack", "suspect"):
        assert await callback(iw.client, iw, reference, action, message_id=message_id) == 200
    async with iw.factory() as session:
        row = await session.get(ContactNotification, uuid.UUID(reference))
        assert row
        assert row.state == NotificationState.SUSPICION
        tx = await session.get(Transaction, row.transaction_id)
        assert tx
        assert tx.status == TransactionStatus.COOLING_OFF
        assert (
            await session.scalar(
                select(func.count())
                .select_from(IntegrationAudit)
                .where(IntegrationAudit.resource_id == row.id)
            )
            == 4
        )


@pytest.mark.parametrize(("chat", "message_id"), [(999, "wrong"), (123, "wrong"), (123, None)])
async def test_callback_authentication(
    iw: IntegrationWorld, chat: int, message_id: str | None
) -> None:
    queued = await iw.queue(await iw.verified())
    await iw.deliver()
    assert await callback(iw.client, iw, str(queued["id"]), "ack", chat, message_id) == 403


async def test_revoked_consent_prevents_future_notifications(iw: IntegrationWorld) -> None:
    contact = await iw.verified()
    for _ in range(2):
        response = await iw.client.delete(f"{ROOT}/{contact}", headers=iw.auth())
        assert response.status_code == 200
    tx = await iw.transfer()
    response = await iw.client.post(
        f"{ROOT}/transactions/{tx['transaction_id']}/notifications",
        headers=iw.auth(),
        json={"contact_id": contact},
    )
    assert response.status_code == 409


async def test_crash_claim_is_never_retried(iw: IntegrationWorld) -> None:
    queued = await iw.queue(await iw.verified())
    async with iw.factory() as session:
        row = await session.get(ContactNotification, uuid.UUID(str(queued["id"])))
        assert row
        row.claimed_at = utcnow() - timedelta(seconds=31)
        await session.commit()
    await iw.deliver()
    assert not iw.adapter.messages
    async with iw.factory() as session:
        row = await session.get(ContactNotification, uuid.UUID(str(queued["id"])))
        assert row
        assert row.error_code == "delivery_uncertain"


@pytest.mark.parametrize("language", ["ru", "kk"])
async def test_templates_do_not_leak_financial_data(iw: IntegrationWorld, language: str) -> None:
    await iw.queue(await iw.verified(language))
    await iw.deliver()
    _, text, actual_language = next(iter(iw.adapter.messages.values()))
    assert actual_language == language
    for private in (
        iw.owner.full_name,
        iw.owner.iin,
        iw.owner.iban,
        iw.recipient.phone,
        "1500000",
        str(iw.owner.id),
    ):
        assert private not in text

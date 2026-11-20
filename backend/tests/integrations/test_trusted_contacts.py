import asyncio
import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from app.db.base import utcnow
from app.integrations.models import ContactNotification, IntegrationAudit, TrustedContact
from app.integrations.telegram.schemas import NotificationState
from app.models import EdgeType, GraphEdge, Transaction, TransactionStatus
from tests.integrations.conftest import IntegrationWorld

ROOT = "/api/v1/trusted-contacts"
CLEAN_ANSWERS = {
    "caller_claims_bank_or_police": False,
    "asked_to_move_to_safe_account": False,
    "asked_to_keep_secret_or_install_app": False,
    "initiated_by_customer": True,
    "knows_recipient_personally": True,
}


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


@pytest.mark.parametrize("signal", ["ack", "suspect"])
async def test_saved_answers_are_rechecked_against_the_contact_signal(
    iw: IntegrationWorld, signal: str
) -> None:
    queued = await iw.queue(await iw.verified())
    await iw.deliver()
    tx_id = uuid.UUID(str(queued["transaction_id"]))
    path = f"/api/v1/transfers/{tx_id}/resolve-cooling"
    answers = {"answers": CLEAN_ANSWERS}
    early = await iw.client.post(path, json=answers)
    assert early.json()["status"] == "cooling_off"

    async with iw.factory() as session:
        row = await session.get(ContactNotification, uuid.UUID(str(queued["id"])))
        assert row
        assert row.message_id
        message_id = row.message_id
    assert await callback(iw.client, iw, str(queued["id"]), signal, message_id=message_id) == 200
    async with iw.factory() as session:
        tx = await session.get(Transaction, tx_id)
        assert tx
        tx.cooling_until = utcnow() - timedelta(seconds=1)
        await session.commit()

    response = await iw.client.post(path, json=answers)
    assert response.status_code == 200, response.text
    result = response.json()
    reported = signal == "suspect"
    assert result["status"] == ("blocked" if reported else "approved")
    reasons = [r for r in result["reasons"] if r["code"] == "TRUSTED_CONTACT_SUSPICION"]
    assert len(reasons) == int(reported)
    if reasons:
        assert "Сенімді" in reasons[0]["reason_kk"]
        assert "Доверенное" in reasons[0]["reason_ru"]
    replay = await iw.client.post(path, json=answers)
    assert replay.json()["reasons"] == result["reasons"]
    async with iw.factory() as session:
        transfers = await session.scalar(
            select(GraphEdge.tx_count).where(
                GraphEdge.source_id == iw.owner.id,
                GraphEdge.target_id == iw.recipient.id,
                GraphEdge.edge_type == EdgeType.TRANSFER,
            )
        )
        assert transfers == (None if reported else 1)


async def test_concurrent_contact_signal_and_final_release_have_one_outcome(
    iw: IntegrationWorld,
) -> None:
    queued = await iw.queue(await iw.verified())
    await iw.deliver()
    async with iw.factory() as session:
        row = await session.get(ContactNotification, uuid.UUID(str(queued["id"])))
        assert row
        assert row.message_id
        tx_id, message_id = row.transaction_id, row.message_id
        tx = await session.get(Transaction, tx_id)
        assert tx
        # Keep the simulated Telegram message valid while opening the release window.
        tx.cooling_until = utcnow() - timedelta(seconds=1)
        await session.commit()

    signal, response = await asyncio.gather(
        callback(iw.client, iw, str(queued["id"]), "suspect", message_id=message_id),
        iw.client.post(
            f"/api/v1/transfers/{tx_id}/resolve-cooling", json={"answers": CLEAN_ANSWERS}
        ),
    )
    assert response.status_code == 200, response.text
    assert (signal, response.json()["status"]) in {(200, "blocked"), (409, "approved")}


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

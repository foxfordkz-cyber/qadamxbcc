import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Any

import pytest
from httpx import AsyncClient
from pydantic import SecretStr
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.base import utcnow
from app.integrations.config import IntegrationSettings
from app.integrations.errors import IntegrationError
from app.integrations.models import ContactNotification, IntegrationAudit, TrustedContact
from app.integrations.telegram.fake_adapter import FakeTelegramAdapter
from app.integrations.telegram.handlers import process_update
from app.integrations.telegram.schemas import ContactState, SimulatedUpdate
from app.integrations.telegram.service import TrustedContactService
from app.integrations.telegram.worker import deliver_one
from app.models import Account, RiskEvent, Transaction
from app.models.family_approval import FamilyApproval, FamilyApprovalPolicy
from tests.test_mobile_gateway import ADMIN_CODE, OTHER, OWNER, login
from tests.test_mobile_gateway import mobile_world as mobile_world

SETTINGS = "/mobile/v1/protection/second-confirmation"
API = "/mobile/v1/api/transfers"
CHECK = "/mobile/v1/protection/{}/check"
ANSWERS = {
    "caller_claims_bank_or_police": False,
    "asked_to_move_to_safe_account": False,
    "asked_to_keep_secret_or_install_app": False,
    "initiated_by_customer": True,
    "knows_recipient_personally": True,
}


def contact(owner: uuid.UUID, chat: str) -> TrustedContact:
    return TrustedContact(
        owner_id=owner,
        invitation_expires_at=utcnow(),
        language="ru",
        alias="Близкий",
        state=ContactState.VERIFIED,
        contact_consented_at=utcnow(),
        telegram_chat_id=chat,
    )


def test_private_test_guardian_must_be_distinct_from_registered_payer() -> None:
    cfg = IntegrationSettings(
        enabled=True,
        environment="test",
        telegram_mode="test",
        signing_key=SecretStr("x" * 40),
        telegram_token=SecretStr("offline-unit-test"),
        telegram_allowed_chat_ids=[100, 101],
        family_owner_chats={OWNER: 100},
    )
    assert cfg.approval_chat_allowed(OWNER, 101)
    assert not cfg.approval_chat_allowed(OWNER, 100)
    assert not cfg.approval_chat_allowed(OWNER, 102)
    assert not cfg.approval_chat_allowed(OTHER, 101)


async def evaluate(
    client: AsyncClient, auth: dict[str, str], value: str, key: uuid.UUID
) -> dict[str, Any]:
    response = await client.post(
        API + "/evaluate",
        headers=auth,
        json={
            "request_id": str(key),
            "recipient_id": str(OTHER),
            "amount": value,
            "context": {"is_new_recipient": False},
        },
    )
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()
    return data


@pytest.mark.parametrize("outcome", ["confirmed", "suspicious", "revoked", "expired", "changed"])
async def test_second_confirmation_bound_to_exact_held_transfer(
    mobile_world: tuple[AsyncClient, Any],
    session_factory: async_sessionmaker[AsyncSession],
    outcome: str,
) -> None:
    client, _ = mobile_world
    auth = await login(client)
    admin = await login(client, ADMIN_CODE)
    cfg = IntegrationSettings(enabled=True, signing_key=SecretStr("x" * 40))
    assert (await client.get(SETTINGS, headers=admin)).status_code == 403
    assert (await client.get(SETTINGS, headers=auth)).json()["contact_id"] is None
    async with session_factory() as db:
        mine, foreign = contact(OWNER, "510001"), contact(OTHER, "510002")
        db.add_all([mine, foreign])
        await db.commit()
        mine_id, foreign_id = str(mine.id), str(foreign.id)
        owner = await db.get(Account, OWNER)
        assert owner
        owner.avg_tx_amount = Decimal("250000")
        await db.commit()
    for headers, selected, status in [
        (admin, mine_id, 403),
        (auth, foreign_id, 409),
        (auth, mine_id, 200),
    ]:
        result = await client.post(
            SETTINGS, headers=headers, json={"action": "enable", "contact_id": selected}
        )
        assert result.status_code == status, result.text
    settings = (await client.get(SETTINGS, headers=auth)).json()
    assert settings["contacts"] == [{"id": mine_id, "alias": "Близкий"}]
    assert settings["threshold_kzt"] == "250000"
    key = uuid.uuid4()
    tx = await evaluate(client, auth, "250000", key)
    assert tx["status"] == "cooling_off"
    assert any(r["code"] == "FAMILY_APPROVAL_REQUIRED" for r in tx["reasons"])
    assert (await evaluate(client, auth, "250000", key))["transaction_id"] == tx["transaction_id"]
    tid = uuid.UUID(tx["transaction_id"])
    check, resolve = CHECK.format(tid), f"{API}/{tid}/resolve-cooling"
    assert (await client.get(check, headers=auth)).json()["second_confirmation"][
        "state"
    ] == "pending"
    adapter = FakeTelegramAdapter()
    assert await deliver_one(session_factory, adapter, cfg)
    assert not await deliver_one(session_factory, adapter, cfg)
    assert len(adapter.messages) == 1
    notice_id, (chat_id, body, lang) = next(iter(adapter.messages.items()))
    assert chat_id == 510001
    assert lang == "ru"
    assert "Подтвердите только этот перевод" in body
    assert "250 000 ₸" in body
    assert tx["recipient"]["iban_masked"] in body
    async with session_factory() as db:
        service = TrustedContactService(db, cfg)
        notification = await db.get(ContactNotification, notice_id)
        assert notification
        assert notification.message_id
        message = notification.message_id
        with pytest.raises(IntegrationError, match="invalid_callback"):
            await service.callback(notice_id, chat_id + 1, message, "approve")
        with pytest.raises(IntegrationError, match="invalid_callback"):
            await service.callback(notice_id, chat_id, message + "1", "approve")
        await service.callback(notice_id, chat_id, message, "ack")
        row = await db.get(Transaction, tid)
        assert row
        row.cooling_until = utcnow() - timedelta(seconds=1)
        if outcome == "changed":
            # Approval is authoritative even if a historical explanatory event was archived.
            await db.execute(
                delete(RiskEvent).where(
                    RiskEvent.transaction_id == tid,
                    RiskEvent.rule_code == "FAMILY_APPROVAL_REQUIRED",
                )
            )
        await db.commit()
    assert (await client.get(check, headers=auth)).json()["second_confirmation"][
        "state"
    ] == "pending"
    assert (await client.post(resolve, headers=auth, json={"answers": ANSWERS})).status_code == 409
    assert (
        await client.post(resolve, headers=auth, json={"answers": ANSWERS, "save_only": True})
    ).json()["status"] == "cooling_off"
    async with session_factory() as db:
        service = TrustedContactService(db, cfg)
        for _ in range(2):
            update = await process_update(
                service,
                SimulatedUpdate(
                    kind="approve", chat_id=chat_id, reference=str(notice_id), message_id=message
                ),
            )
            assert update.state == "FAMILY_APPROVAL_RECORDED"
        count = await db.scalar(
            select(func.count())
            .select_from(IntegrationAudit)
            .where(
                IntegrationAudit.event == "FAMILY_APPROVAL_RECORDED",
                IntegrationAudit.resource_id == notice_id,
            )
        )
        assert count == 1
        if outcome == "suspicious":
            await service.callback(notice_id, chat_id, message, "suspect")
        elif outcome == "revoked":
            await service.revoke(uuid.UUID(mine_id), chat_id=chat_id)
        elif outcome == "expired":
            snapshot = await db.get(FamilyApproval, tid)
            assert snapshot
            snapshot.expires_at = utcnow() - timedelta(seconds=1)
            await db.commit()
        elif outcome == "changed":
            row = await db.get(Transaction, tid)
            assert row
            row.amount = Decimal("250000.01")
            await db.commit()
        if outcome != "confirmed":
            with pytest.raises(IntegrationError):
                await service.callback(notice_id, chat_id, message, "approve")
    state = (await client.get(check, headers=auth)).json()["second_confirmation"]["state"]
    home = "/mobile/v1/inbox?view=actions"
    active_messages = (await client.get(home, headers=auth)).json()["items"]
    assert [r["state"] for r in active_messages] == (
        ["FAMILY_APPROVAL_RECORDED"] if outcome == "confirmed" else []
    )
    packet = (await client.get(f"/mobile/v1/protection/{tid}/packet", headers=auth)).json()
    assert sum(event["kind"] == "family_approved" for event in packet["events"]) == 1
    assert state == ("unavailable" if outcome in ("changed", "revoked") else outcome)
    assert (await client.get(f"{API}/{tid}", headers=auth)).json()["status"] == "cooling_off"
    response = await client.post(resolve, headers=auth, json={"answers": ANSWERS})
    if outcome in ("confirmed", "suspicious"):
        assert response.json()["status"] == ("approved" if outcome == "confirmed" else "blocked")
    else:
        assert response.status_code == 409
        cancelled = await client.post(f"{API}/{tid}/cancel", headers=auth, json={})
        assert cancelled.json()["status"] == "cancelled"
    assert (await client.get(check, headers=auth)).json()["second_confirmation"][
        "state"
    ] == "closed"
    assert (await client.get(home, headers=auth)).json()["items"] == []
    inbox = (await client.get("/mobile/v1/inbox", headers=auth)).json()["items"]
    assert sum(r["state"] == "FAMILY_APPROVAL_RECORDED" for r in inbox) == 1


async def test_family_policy_preserves_small_known_and_pending_after_disable(
    mobile_world: tuple[AsyncClient, Any],
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = mobile_world
    auth = await login(client)
    async with session_factory() as db:
        member = contact(OWNER, "510003")
        db.add(member)
        await db.commit()
        cid = str(member.id)
    setting = {"action": "enable", "contact_id": cid}
    await client.post(SETTINGS, headers=auth, json=setting)
    disabled = (await client.post(SETTINGS, headers=auth, json={"action": "disable"})).json()
    assert disabled["contact_id"] == cid
    assert disabled["disable_at"]
    repeat = (await client.post(SETTINGS, headers=auth, json={"action": "disable"})).json()
    assert repeat["disable_at"] == disabled["disable_at"]
    assert (await client.post(SETTINGS, headers=auth, json=setting)).json()["disable_at"] is None
    tx = await evaluate(client, auth, "250000", uuid.uuid4())
    tid = uuid.UUID(tx["transaction_id"])
    async with session_factory() as db:
        policy = await db.get(FamilyApprovalPolicy, OWNER)
        assert policy
        policy.disable_at = utcnow() - timedelta(seconds=1)
        await db.commit()
    assert (await client.get(SETTINGS, headers=auth)).json()["contact_id"] is None
    assert (await client.get(CHECK.format(tid), headers=auth)).json()["second_confirmation"][
        "state"
    ] == "pending"
    await client.post(f"{API}/{tid}/cancel", headers=auth, json={})
    await client.post(SETTINGS, headers=auth, json=setting)
    small = await evaluate(client, auth, "1000", uuid.uuid4())
    assert small["status"] == "approved"
    known = await evaluate(client, auth, "250000", uuid.uuid4())
    for tx in [small, known]:
        assert all(r["code"] != "FAMILY_APPROVAL_REQUIRED" for r in tx["reasons"])
        assert (await client.get(CHECK.format(tx["transaction_id"]), headers=auth)).json()[
            "second_confirmation"
        ] is None

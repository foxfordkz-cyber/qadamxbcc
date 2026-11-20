import uuid
from collections.abc import AsyncIterator
from decimal import Decimal
from typing import Any

import fakeredis
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.kz import make_kz_iban
from app.core.resources import Resources
from app.integrations.config import IntegrationSettings
from app.mobile_gateway.app import create_mobile_app, session_key
from app.mobile_gateway.config import MobileSettings
from app.mobile_gateway.passwords import encode
from app.models import Account, Transaction, TransactionStatus

CLIENT_CODE = "synthetic-client-code-1234567890ABC"
ADMIN_CODE = "synthetic-admin-code-0987654321XYZ"
OWNER = uuid.UUID("00000000-0000-4000-8000-000000000001")
OTHER = uuid.UUID("00000000-0000-4000-8000-000000000002")


@pytest.fixture
async def mobile_world(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[tuple[AsyncClient, Any]]:
    async with session_factory() as session:
        for index, account_id in enumerate([OWNER, OTHER], 1):
            session.add(
                Account(
                    id=account_id,
                    iin=f"90010130000{index}",
                    iban=make_kz_iban(f"{index:013d}"),
                    phone=f"+7701000000{index}",
                    full_name=f"Synthetic User {index}",
                    device_id=f"mobile-{index}",
                    avg_tx_amount=Decimal("40000"),
                )
            )
        await session.commit()
    redis = fakeredis.FakeAsyncRedis()
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    res = Resources.build(settings, session_factory=session_factory, redis=redis)
    config = MobileSettings(
        enabled=True, client_code=SecretStr(CLIENT_CODE), admin_code=SecretStr(ADMIN_CODE)
    )
    integrations = IntegrationSettings(enabled=True, signing_key=SecretStr("x" * 40))
    app = create_mobile_app(config, settings, res, integrations)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        yield client, redis
    await redis.aclose()


async def login(client: AsyncClient, code: str = CLIENT_CODE) -> dict[str, str]:
    response = await client.post("/mobile/v1/sessions", json={"code": code})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def test_role_chosen_by_secret_not_request(mobile_world: tuple[AsyncClient, Any]) -> None:
    client, _ = mobile_world
    invalid = await client.post("/mobile/v1/sessions", json={"code": CLIENT_CODE, "role": "admin"})
    assert invalid.status_code == 422
    assert CLIENT_CODE not in invalid.text
    for code, role in [(CLIENT_CODE, "client"), (ADMIN_CODE, "admin")]:
        headers = await login(client, code)
        response = await client.get("/mobile/v1/session", headers=headers)
        assert response.json()["role"] == role
        assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "path",
    [
        "soc/feed",
        f"soc/graph/{OWNER}",
        "integrations/health/details",
        "integrations/guardian/soc/cases",
        "../soc/feed",
        "trusted-contacts/simulator/update",
    ],
)
async def test_client_cannot_use_admin_or_simulator(
    mobile_world: tuple[AsyncClient, Any],
    path: str,
) -> None:
    client, _ = mobile_world
    response = await client.get(f"/mobile/v1/api/{path}", headers=await login(client))
    assert response.status_code in (403, 404)


async def test_admin_cannot_transfer_or_change_cooling(
    mobile_world: tuple[AsyncClient, Any],
) -> None:
    client, _ = mobile_world
    headers = await login(client, ADMIN_CODE)
    for path in [
        "transfers/evaluate",
        f"transfers/{uuid.uuid4()}/cancel",
        f"transfers/{uuid.uuid4()}/resolve-cooling",
    ]:
        response = await client.post(f"/mobile/v1/api/{path}", headers=headers, json={})
        assert response.status_code == 403


async def test_real_core_evaluation_ownership_and_admin_feed(
    mobile_world: tuple[AsyncClient, Any],
) -> None:
    client, _ = mobile_world
    headers = await login(client)
    body = {"request_id": str(uuid.uuid4()), "recipient_id": str(OTHER), "amount": "25000"}
    foreign = await client.post(
        "/mobile/v1/api/transfers/evaluate", headers=headers, json={**body, "sender_id": str(OTHER)}
    )
    assert foreign.status_code == 403
    first = await client.post("/mobile/v1/api/transfers/evaluate", headers=headers, json=body)
    assert first.status_code == 200, first.text
    result = first.json()
    assert result["ml_model_version"]
    repeat = await client.post("/mobile/v1/api/transfers/evaluate", headers=headers, json=body)
    assert repeat.json()["transaction_id"] == result["transaction_id"]
    history = await client.get("/mobile/v1/transfers", headers=headers)
    assert len(history.json()["items"]) == 1
    feed = await client.get("/mobile/v1/api/soc/feed", headers=await login(client, ADMIN_CODE))
    assert feed.status_code == 200
    assert feed.json()["stats"]["total"] == 1
    assert (await client.get("/api/v1/soc/feed", headers=headers)).status_code == 404


async def test_server_cooling_stays_held_after_clean_answers(
    mobile_world: tuple[AsyncClient, Any],
) -> None:
    client, _ = mobile_world
    headers = await login(client)
    response = await client.post(
        "/mobile/v1/api/transfers/evaluate",
        headers=headers,
        json={
            "request_id": str(uuid.uuid4()),
            "recipient_id": str(OTHER),
            "amount": "900000",
            "context": {"active_call": True, "from_deposit": True, "is_new_recipient": True},
        },
    )
    result = response.json()
    assert response.status_code == 200, response.text
    assert result["status"] == "cooling_off"
    assert result["cooling_off_until"]
    answers = {
        "caller_claims_bank_or_police": False,
        "asked_to_move_to_safe_account": False,
        "asked_to_keep_secret_or_install_app": False,
        "initiated_by_customer": True,
        "knows_recipient_personally": True,
    }
    resolved = await client.post(
        f"/mobile/v1/api/transfers/{result['transaction_id']}/resolve-cooling",
        headers=headers,
        json={"answers": answers},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "cooling_off"
    cancelled = await client.post(
        f"/mobile/v1/api/transfers/{result['transaction_id']}/cancel", headers=headers, json={}
    )
    assert cancelled.json()["status"] == "cancelled"


async def test_expiration_logout_and_login_quota(mobile_world: tuple[AsyncClient, Any]) -> None:
    client, redis = mobile_world
    headers = await login(client)
    token = headers["Authorization"].split()[1]
    assert 0 < await redis.ttl(session_key(token)) <= 1800
    assert (await client.delete("/mobile/v1/session", headers=headers)).status_code == 204
    assert (await client.get("/mobile/v1/session", headers=headers)).status_code == 401
    for _ in range(8):
        result = await client.post(
            "/mobile/v1/sessions", json={"code": "invalid-code-1234567890ABCDE"}
        )
    assert result.status_code == 429
    assert result.headers["Retry-After"] == "60"


async def test_inputs_do_not_leak_and_bodies_bounded(mobile_world: tuple[AsyncClient, Any]) -> None:
    client, _ = mobile_world
    headers = await login(client)
    response = await client.post(
        "/mobile/v1/api/transfers/evaluate",
        headers=headers,
        json={"request_id": str(uuid.uuid4()), "secret": "DO-NOT-ECHO"},
    )
    assert response.status_code == 422
    assert "DO-NOT-ECHO" not in response.text
    response = await client.post("/mobile/v1/sessions", content=b"x" * 17000)
    assert response.status_code == 413


async def test_private_scam_check_and_contact_read(mobile_world: tuple[AsyncClient, Any]) -> None:
    client, _ = mobile_world
    headers = await login(client)
    response = await client.post(
        "/mobile/v1/api/integrations/guardian/scam-check",
        headers=headers,
        json={"text": "Переведите на безопасный счёт", "language": "ru"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "signals_detected"
    assert (await client.get("/mobile/v1/api/trusted-contacts", headers=headers)).status_code == 200


def test_gateway_disabled_by_default() -> None:
    with pytest.raises(ValueError, match="explicitly enabled"):
        create_mobile_app(MobileSettings())


async def test_other_customer_transaction_is_not_readable_or_cancellable(
    mobile_world: tuple[AsyncClient, Any],
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = mobile_world
    other_id = uuid.uuid4()
    async with session_factory() as session:
        session.add(
            Transaction(
                id=other_id,
                request_id=other_id,
                sender_id=OTHER,
                recipient_id=OWNER,
                amount=Decimal("100"),
                currency="KZT",
                status=TransactionStatus.COOLING_OFF,
                device_id="other-test-device",
            )
        )
        await session.commit()
    headers = await login(client)
    for method, suffix in [("GET", ""), ("POST", "/cancel"), ("POST", "/resolve-cooling")]:
        response = await client.request(
            method, f"/mobile/v1/api/transfers/{other_id}{suffix}", headers=headers, json={}
        )
        assert response.status_code == 404
    history = await client.get("/mobile/v1/transfers", headers=headers)
    assert history.json()["items"] == []
    replay = await client.post(
        "/mobile/v1/api/transfers/evaluate",
        headers=headers,
        json={
            "request_id": str(other_id),
            "recipient_id": str(OTHER),
            "amount": "100",
        },
    )
    assert replay.status_code == 404


async def test_abandon_is_owned_and_prevents_late_execution(
    mobile_world: tuple[AsyncClient, Any],
) -> None:
    client, _ = mobile_world
    headers = await login(client)
    request_id = uuid.uuid4()
    route = f"/mobile/v1/api/transfers/requests/{request_id}/abandon"
    assert (await client.post(route, headers=headers, json={})).status_code == 404
    invalid = await client.post(
        "/mobile/v1/api/transfers/evaluate", headers=headers, json={"request_id": str(request_id)}
    )
    assert invalid.status_code == 422
    abandoned = await client.post(route, headers=headers, json={})
    assert abandoned.status_code == 200, abandoned.text
    assert abandoned.json()["status"] == "abandoned"
    late = await client.post(
        "/mobile/v1/api/transfers/evaluate",
        headers=headers,
        json={
            "request_id": str(request_id),
            "recipient_id": str(OTHER),
            "amount": "100",
        },
    )
    assert late.status_code == 409
    history = await client.get("/mobile/v1/transfers", headers=headers)
    assert not history.json()["items"]


async def test_session_expiry_fails_closed(mobile_world: tuple[AsyncClient, Any]) -> None:
    client, redis = mobile_world
    headers = await login(client)
    await redis.expire(session_key(headers["Authorization"].split()[1]), -1)
    assert (await client.get("/mobile/v1/transfers", headers=headers)).status_code == 401


async def test_no_credentials_means_no_mobile_data(mobile_world: tuple[AsyncClient, Any]) -> None:
    client, _ = mobile_world
    for path in ["/mobile/v1/session", "/mobile/v1/transfers", "/mobile/v1/api/soc/feed"]:
        assert (await client.get(path)).status_code == 401


async def test_mobile_health_does_not_expose_secrets(mobile_world: tuple[AsyncClient, Any]) -> None:
    client, _ = mobile_world
    response = await client.get("/health")
    assert response.json() == {"status": "ok", "mode": "synthetic-test"}


async def test_two_password_accounts_restore_and_revoke(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        session.add(
            Account(
                id=OWNER,
                iin="900101300001",
                iban=make_kz_iban("0000000000001"),
                phone="+77010000001",
                full_name="Test",
                device_id="synthetic",
            )
        )
        await session.commit()
    fake = fakeredis.FakeAsyncRedis()
    cfg = Settings(database_url="sqlite+aiosqlite:///:memory:")
    res = Resources.build(cfg, session_factory=session_factory, redis=fake)
    client_pw, staff_pw = str(uuid.uuid4()), str(uuid.uuid4())
    mobile = MobileSettings(
        enabled=True,
        auth_mode="password",
        client_hash=SecretStr(encode(client_pw)),
        admin_hash=SecretStr(encode(staff_pw)),
    )
    app = create_mobile_app(mobile, cfg, res, IntegrationSettings())
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://stand") as client,
    ):

        async def sign(name: str, pw: str) -> Any:
            return await client.post("/mobile/v1/auth/login", json={"login": name, "password": pw})

        assert (await sign("client_demo", staff_pw)).status_code == 401
        assert (await sign("admin_demo", client_pw)).status_code == 401
        assert (
            await client.post("/mobile/v1/sessions", json={"code": CLIENT_CODE})
        ).status_code == 404
        assert (
            await client.post(
                "/mobile/v1/auth/login",
                json={"login": "client_demo", "password": client_pw, "role": "admin"},
            )
        ).status_code == 422
        for name, password, role in [
            ("client_demo", client_pw, "client"),
            ("admin_demo", staff_pw, "admin"),
        ]:
            result = (await sign(name, password)).json()
            headers = {"Authorization": "Bearer " + result["token"]}
            assert result["role"] == role
            assert (await client.get("/mobile/v1/session", headers=headers)).json()["role"] == role
            assert (await client.get("/mobile/v1/account", headers=headers)).status_code == (
                200 if role == "client" else 403
            )
            if role == "client":
                assert (
                    await client.get("/mobile/v1/api/soc/feed", headers=headers)
                ).status_code == 403
                assert (await client.get("/mobile/v1/inbox", headers=headers)).json() == {
                    "items": []
                }
            assert (await client.delete("/mobile/v1/session", headers=headers)).status_code == 204
            assert (await client.get("/mobile/v1/session", headers=headers)).status_code == 401
    await fake.aclose()


async def call_tx(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post(
        "/mobile/v1/api/transfers/evaluate",
        headers=headers,
        json={
            "request_id": str(uuid.uuid4()),
            "recipient_id": str(OTHER),
            "amount": "900000",
            "context": {"active_call": True, "is_new_recipient": True, "from_deposit": True},
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "cooling_off"
    return str(response.json()["transaction_id"])


async def test_post_call_quiet_period_and_packet(
    mobile_world: tuple[AsyncClient, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import timedelta

    from app.mobile_gateway import protection

    client, _ = mobile_world
    auth = await login(client)
    txid = await call_tx(client, auth)
    path = f"/mobile/v1/protection/{txid}"
    assert (await client.get(path + "/check", headers=auth)).json()["state"] == "on_call"
    from app.db.base import utcnow

    now = utcnow()
    monkeypatch.setattr(protection, "utcnow", lambda: now)
    ended = (await client.post(path + "/end", headers=auth)).json()
    now += timedelta(seconds=299)
    assert (await client.post(path + "/end", headers=auth)).json()["ready_at"] == ended["ready_at"]
    assert (
        await client.post(path + "/answer", headers=auth, json={"answer": "pressure"})
    ).status_code == 409
    assert (await client.get("/mobile/v1/account", headers=auth)).json()["pending_call"] == txid
    now += timedelta(seconds=1)
    assert (await client.get(path + "/check", headers=auth)).json()["state"] == "ready"
    for _ in range(2):
        assert (
            await client.post(path + "/answer", headers=auth, json={"answer": "pressure"})
        ).json()["state"] == "answered"
    assert (
        await client.post(path + "/answer", headers=auth, json={"answer": "my_choice"})
    ).status_code == 409
    packet = (await client.get(path + "/packet", headers=auth)).json()
    assert packet["status"] == "cooling_off"
    assert [e["kind"] for e in packet["events"]].count("pressure") == 1
    assert "phone" not in str(packet)
    assert "iban" not in str(packet)
    assert (await client.get("/mobile/v1/account", headers=auth)).json()["pending_call"] is None


async def test_family_switch_delay_independent_of_contact(
    mobile_world: tuple[AsyncClient, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import timedelta

    from app.mobile_gateway import protection

    client, _ = mobile_world
    auth = await login(client)
    base = "/mobile/v1/protection/family"
    from app.db.base import utcnow

    now = utcnow()
    monkeypatch.setattr(protection, "utcnow", lambda: now)
    assert not (await client.get(base, headers=auth)).json()["enabled"]
    assert (await client.post(base, headers=auth, json={"action": "enable"})).json()["enabled"]
    first = (await client.post(base, headers=auth, json={"action": "disable"})).json()
    now += timedelta(hours=23, minutes=59)
    assert (await client.post(base, headers=auth, json={"action": "disable"})).json() == first
    now += timedelta(minutes=1)
    assert not (await client.get(base, headers=auth)).json()["enabled"]
    assert (await client.post(base, headers=auth, json={"action": "enable"})).json() == {
        "enabled": True,
        "disable_at": None,
    }
    txid = await call_tx(client, auth)
    assert (
        await client.post(f"/mobile/v1/protection/{txid}/notify", headers=auth)
    ).status_code == 409


async def test_protection_requires_owner(
    mobile_world: tuple[AsyncClient, Any], session_factory: async_sessionmaker[AsyncSession]
) -> None:
    client, _ = mobile_world
    owner = await login(client)
    admin = await login(client, ADMIN_CODE)
    txid = await call_tx(client, owner)
    path = f"/mobile/v1/protection/{txid}"
    assert (await client.get(path + "/packet")).status_code == 401
    assert (await client.get(path + "/check", headers=admin)).status_code == 403
    async with session_factory() as db:
        tx = await db.get(Transaction, uuid.UUID(txid))
        assert tx is not None
        tx.sender_id = OTHER
        await db.commit()
    assert (await client.get(path + "/packet", headers=owner)).status_code == 404
    assert (await client.post(path + "/end", headers=owner)).status_code == 404


async def test_family_one_recipient_actual_callback(
    mobile_world: tuple[AsyncClient, Any], session_factory: async_sessionmaker[AsyncSession]
) -> None:
    from datetime import timedelta

    from sqlalchemy import select

    from app.db.base import utcnow
    from app.integrations.models import ContactNotification, TrustedContact
    from app.integrations.telegram.fake_adapter import FakeTelegramAdapter
    from app.integrations.telegram.service import TrustedContactService
    from app.integrations.telegram.worker import deliver_one

    client, _ = mobile_world
    auth = await login(client)
    txid = await call_tx(client, auth)
    path = f"/mobile/v1/protection/{txid}"
    await client.post("/mobile/v1/protection/family", headers=auth, json={"action": "enable"})
    cfg = IntegrationSettings(enabled=True, signing_key=SecretStr("x" * 40))
    async with session_factory() as db:
        for chat in ["880001", "880002"]:
            db.add(
                TrustedContact(
                    owner_id=OWNER,
                    invitation_expires_at=utcnow() + timedelta(hours=1),
                    language="ru",
                    state="CONTACT_VERIFIED",
                    contact_consented_at=utcnow(),
                    telegram_chat_id=chat,
                )
            )
        await db.commit()
    for _ in range(2):
        reply = await client.post(path + "/notify", headers=auth)
        assert reply.status_code == 200, reply.text
        assert reply.json()["contact_state"] == "NOTIFICATION_QUEUED"
    adapter = FakeTelegramAdapter()
    assert await deliver_one(session_factory, adapter, cfg)
    assert len(adapter.messages) == 1
    assert "во время запроса шёл звонок" in next(iter(adapter.messages.values()))[1]
    async with session_factory() as db:
        notices = (await db.scalars(select(ContactNotification))).all()
        assert len(notices) == 1
        notice = notices[0]
        contact = await db.get(TrustedContact, notice.contact_id)
        assert contact is not None
        assert contact.telegram_chat_id is not None
        assert notice.state == "NOTIFICATION_SENT"
        assert notice.message_id is not None
        await TrustedContactService(db, cfg).callback(
            notice.id, int(contact.telegram_chat_id), notice.message_id, "ack"
        )
    check = (await client.get(path + "/check", headers=auth)).json()
    assert check["contact_state"] == "CONTACT_ACKNOWLEDGED"
    assert check["answer"] is None


async def test_wallet_amounts_history_and_role_boundaries(
    mobile_world: tuple[AsyncClient, Any],
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    client, _ = mobile_world
    # Only approved receipts belong to the recipient's wallet.
    ids = []
    async with session_factory() as session:
        for sender, receiver, value, state in [
            (OWNER, OTHER, "145.54", TransactionStatus.APPROVED),
            (OTHER, OWNER, "40.04", TransactionStatus.APPROVED),
            (OWNER, OTHER, "700", TransactionStatus.BLOCKED),
            (OTHER, OWNER, "900", TransactionStatus.COOLING_OFF),
        ]:
            ident = uuid.uuid4()
            ids.append(str(ident))
            session.add(
                Transaction(
                    id=ident,
                    request_id=ident,
                    sender_id=sender,
                    recipient_id=receiver,
                    amount=Decimal(value),
                    currency="KZT",
                    status=state,
                    device_id="wallet-test",
                )
            )
        await session.commit()
    headers = await login(client)
    base = "/mobile/v1/wallet/"
    account = (await client.get("/mobile/v1/account", headers=headers)).json()
    assert account["balance"] == "4999894.50"
    assert len(account["card_last4"]) == 4
    ledger = (await client.get(base + "operations", headers=headers)).json()["items"]
    assert {r["transaction_id"] for r in ledger} == set(ids[:3])
    assert (await client.get(base + "incoming/" + ids[1], headers=headers)).json()[
        "amount"
    ] == "40.04"
    assert (await client.get(base + "incoming/" + ids[3], headers=headers)).status_code == 404
    for days in (7, 30, 90):
        stats = (await client.get(base + f"analytics?days={days}", headers=headers)).json()
        assert (stats["incoming"], stats["outgoing"], stats["count"], stats["blocked"]) == (
            "40.04",
            "145.54",
            3,
            1,
        )
        nonempty = [r for r in stats["series"] if r["count"]]
        assert len(nonempty) == 1
        assert len(stats["series"]) == days
        query = {
            "day": nonempty[0]["day"],
            "q": ids[2],
            "status": "blocked",
            "direction": "outgoing",
        }
        filtered = (await client.get(base + "operations", params=query, headers=headers)).json()
        assert [r["transaction_id"] for r in filtered["items"]] == [ids[2]]
    assert (await client.get(base + "analytics?days=2", headers=headers)).status_code == 422
    assert (await client.get(base + "soc", headers=headers)).status_code == 403
    assert (await client.get(base + "cases", headers=headers)).status_code == 403
    admin = await login(client, ADMIN_CODE)
    stats = (await client.get(base + "soc", headers=admin)).json()
    assert stats["states"]["blocked"]["amount"] == "700.00"
    assert stats["states"]["cooling_off"]["amount"] == "900.00"
    assert stats["blocked_recipients"] == 1
    assert (await client.get(base + "analytics", headers=admin)).status_code == 403
    assert (await client.get(base + "cases?state=NEW", headers=admin)).json()["items"] == []

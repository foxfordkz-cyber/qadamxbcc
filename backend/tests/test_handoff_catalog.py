import random
from uuid import uuid4

import fakeredis
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.resources import Resources
from app.db.base import utcnow
from app.integrations.cases.models import FraudCase
from app.integrations.config import IntegrationSettings
from app.integrations.models import ContactNotification
from app.mobile_gateway.app import create_mobile_app
from app.mobile_gateway.config import MobileSettings
from app.mobile_gateway.demo_catalog import SAVED_TRANSFERS
from app.mobile_gateway.passwords import encode
from app.mobile_gateway.wallet import balance
from app.models import Transaction
from scripts.handoff_data import populate
from scripts.seed_bcc import DEMO_ACCOUNTS, FRIEND_ID, SENDER_ID, Factory


async def test_handoff_import_catalog_and_authenticated_transfer(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    people = Factory(random.Random(42), utcnow())
    async with session_factory() as db:
        db.add_all([people.demo(person).to_account() for person in DEMO_ACCOUNTS])
        db.add_all([people.background().to_account() for _ in range(12)])
        await db.commit()
        expected = await balance(db, SENDER_ID)
        assert (await populate(db))["added"] == 40
        await db.commit()
        assert (await populate(db))["added"] == 0
        assert await db.scalar(select(func.count()).select_from(Transaction)) == 40
        assert await db.scalar(select(func.count()).select_from(FraudCase)) == 10
        assert await db.scalar(select(func.count()).select_from(ContactNotification)) == 0
        assert await balance(db, SENDER_ID) == expected

    cfg = Settings(database_url="sqlite+aiosqlite:///:memory:")
    password = str(uuid4())
    roles = MobileSettings(
        enabled=True,
        auth_mode="password",
        client_hash=SecretStr(encode(password)),
        admin_hash=SecretStr(encode(str(uuid4()))),
    )
    base = "/mobile/v1"
    async with fakeredis.FakeAsyncRedis() as cache:
        resources = Resources.build(cfg, session_factory=session_factory, redis=cache)
        app = create_mobile_app(roles, cfg, resources, IntegrationSettings())
        async with (
            app.router.lifespan_context(app),
            AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
        ):
            signed = await client.post(
                base + "/auth/login", json={"login": "client_demo", "password": password}
            )
            auth = {"Authorization": "Bearer " + signed.json()["token"]}
            entries = (await client.get(base + "/account", headers=auth)).json()["recipients"]
            assert len(entries) == 7
            saved = {item["payee_ref"]: item for item in entries if "payee_ref" in item}
            assert saved.keys() == SAVED_TRANSFERS.keys()
            lookup = base + "/api/payee-check"
            for ref, item in saved.items():
                query = {"recipient": ref, "bank": "bcc", "expected_name": item["name"]}
                checked = (await client.post(lookup, headers=auth, json=query)).json()
                assert checked["recipient"] == ref
                assert checked["status"] == "match"
                assert checked["display_name"].endswith(".")
                assert checked["display_name"] != item["name"]
            item = saved["saved-1"]
            slate = {"recipient": "saved-1", "bank": "bcc", "expected_name": "Другое Имя"}
            mismatch = (await client.post(lookup, headers=auth, json=slate)).json()
            assert mismatch["status"] == "mismatch"
            outside = await client.post(lookup, headers=auth, json={**slate, "bank": "other"})
            assert outside.json()["status"] == "unavailable"
            assert outside.json()["display_name"] is None
            send = base + "/api/transfers/evaluate"
            draft = {"recipient_phone": item["phone"], "request_id": str(uuid4()), "amount": "1000"}
            paid = await client.post(send, headers=auth, json=draft)
            assert paid.status_code == 200, paid.text
            repeated = await client.post(send, headers=auth, json=draft)
            assert repeated.json()["transaction_id"] == paid.json()["transaction_id"]
            # The saved link is only valid for the owner of the catalog transfer.
            async with session_factory() as db:
                previous = await db.get(Transaction, SAVED_TRANSFERS["saved-1"])
                assert previous
                previous.sender_id = FRIEND_ID
                await db.commit()
            entries = (await client.get(base + "/account", headers=auth)).json()["recipients"]
            assert item["phone"] not in [entry["phone"] for entry in entries]
            missing = (await client.post(lookup, headers=auth, json=slate)).json()
            assert missing["status"] == "unavailable"
            assert missing["display_name"] is None
            denied = await client.post(
                send, headers=auth, json={**draft, "request_id": str(uuid4())}
            )
            assert denied.status_code == 422
            async with session_factory() as db:
                assert await db.scalar(select(func.count()).select_from(Transaction)) == 41

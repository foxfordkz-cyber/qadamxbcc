import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from decimal import Decimal

import fakeredis
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings
from app.core.kz import make_kz_iban
from app.core.resources import Resources
from app.db.base import Base
from app.db.session import build_engine
from app.integrations.config import IntegrationSettings
from app.integrations.security import Principal, Role, issue_token
from app.integrations.telegram.fake_adapter import FakeTelegramAdapter
from app.integrations.telegram.worker import deliver_one
from app.main import create_app
from app.models import Account

TEST_KEY = "synthetic-test-signing-key-not-for-deployment"


@pytest.fixture
async def db_engine() -> AsyncIterator[AsyncEngine]:
    url = os.getenv("BCC_TEST_DATABASE_URL")
    if url:
        if not url.rsplit("/", 1)[-1].startswith("bcc_integration_test"):
            raise RuntimeError(
                "live tests require an explicitly named bcc_integration_test database"
            )
        schema = "test_" + uuid.uuid4().hex
        admin = create_async_engine(url)
        async with admin.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema}})
    else:
        engine = build_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        await engine.dispose()
        if url:
            async with admin.begin() as conn:
                await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            await admin.dispose()


@dataclass
class IntegrationWorld:
    app: FastAPI
    client: AsyncClient
    factory: async_sessionmaker[AsyncSession]
    cfg: IntegrationSettings
    owner: Account
    recipient: Account
    adapter: FakeTelegramAdapter
    redis: Redis

    def auth(self, role: Role = "owner", subject: uuid.UUID | None = None) -> dict[str, str]:
        token = issue_token(Principal(subject=subject or self.owner.id, role=role), TEST_KEY)
        return {"Authorization": f"Bearer {token}"}

    async def invite(self, language: str = "ru") -> dict[str, object]:
        response = await self.client.post(
            "/api/v1/trusted-contacts",
            headers=self.auth(),
            json={"owner_consent": True, "language": language},
        )
        assert response.status_code == 201, response.text
        result: dict[str, object] = response.json()
        return result

    async def verified(self, language: str = "ru") -> str:
        invite = await self.invite(language)
        bind = await self.client.post(
            "/api/v1/trusted-contacts/simulator/update",
            headers=self.auth("simulator"),
            json={"kind": "start", "chat_id": 123, "reference": invite["invitation_token"]},
        )
        assert bind.status_code == 200, bind.text
        contact_id: str = bind.json()["resource_id"]
        consent = await self.client.post(
            "/api/v1/trusted-contacts/simulator/update",
            headers=self.auth("simulator"),
            json={"kind": "consent", "chat_id": 123, "reference": contact_id},
        )
        assert consent.status_code == 200
        return contact_id

    async def transfer(self, *, cooling: bool = True) -> dict[str, object]:
        response = await self.client.post(
            "/api/v1/transfers/evaluate",
            json={
                "sender_id": str(self.owner.id),
                "recipient_id": str(self.recipient.id),
                "amount": "1500000" if cooling else "1000",
                "occurred_at": "2026-11-13T09:00:00Z",
                "context": {"active_call": cooling, "from_deposit": cooling},
            },
        )
        assert response.status_code == 200, response.text
        result: dict[str, object] = response.json()
        assert result["status"] == ("cooling_off" if cooling else "approved")
        return result

    async def queue(self, contact_id: str) -> dict[str, object]:
        tx = await self.transfer()
        response = await self.client.post(
            f"/api/v1/trusted-contacts/transactions/{tx['transaction_id']}/notifications",
            headers=self.auth(),
            json={"contact_id": contact_id},
        )
        assert response.status_code == 200, response.text
        result: dict[str, object] = response.json()
        return result

    async def deliver(self) -> bool:
        return await deliver_one(self.factory, self.adapter, self.cfg)


@pytest.fixture
async def iw(session_factory: async_sessionmaker[AsyncSession]) -> AsyncIterator[IntegrationWorld]:
    accounts = [
        Account(
            iin=f"0000000{n:05d}",
            iban=make_kz_iban(f"{n:013d}"),
            phone=f"+7700000{n:04d}",
            full_name=f"Synthetic {n}",
            device_id=f"test-{n}",
            avg_tx_amount=Decimal("40000"),
        )
        for n in (1, 2)
    ]
    async with session_factory() as session:
        session.add_all(accounts)
        await session.commit()
    redis_url = os.getenv("BCC_TEST_REDIS_URL")
    if redis_url and not redis_url.endswith("/15"):
        raise RuntimeError("live tests require isolated Redis database 15")
    redis: Redis = Redis.from_url(redis_url) if redis_url else fakeredis.FakeAsyncRedis()
    if redis_url:
        await redis.flushdb()
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    resources = Resources.build(settings, session_factory=session_factory, redis=redis)
    cfg = IntegrationSettings(
        enabled=True, signing_key=SecretStr(TEST_KEY), rate_limit_per_minute=300
    )
    app = create_app(settings, resources)
    app.state.integration_settings = cfg
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        yield IntegrationWorld(
            app,
            client,
            session_factory,
            cfg,
            accounts[0],
            accounts[1],
            FakeTelegramAdapter(),
            redis,
        )
    await redis.aclose()

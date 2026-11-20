import asyncio
import re
from unittest.mock import AsyncMock

import pytest
from aiogram import Bot, Dispatcher
from pydantic import SecretStr, ValidationError

from app.integrations.config import IntegrationSettings
from app.integrations.telegram.bot import build_ingress_router
from app.integrations.telegram.web_session import issue_code
from tests.integrations.conftest import IntegrationWorld
from tests.integrations.test_bot_assistant import Chat

BASE = "/api/v1/trusted-contacts"
LOGIN = f"{BASE}/web-session"


def web_settings(iw: IntegrationWorld) -> IntegrationSettings:
    cfg = IntegrationSettings(
        **{
            **iw.cfg.model_dump(),
            "environment": "test",
            "telegram_mode": "test",
            "telegram_token": SecretStr("synthetic-unused-token"),
            "telegram_allowed_chat_ids": [123, 456],
            "circle_web_owners": {123: iw.owner.id},
        }
    )
    iw.app.state.integration_settings = cfg
    return cfg


async def test_bot_to_private_circle_login_and_isolation(
    iw: IntegrationWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    other_contact = await iw.client.post(
        BASE,
        headers=iw.auth(subject=iw.recipient.id),
        json={"owner_consent": True, "language": "ru"},
    )
    assert other_contact.status_code == 201
    cfg = web_settings(iw)
    bot = Bot("123456789:" + "A" * 35)  # synthetic, never sent to Telegram
    request = AsyncMock(return_value=True)
    monkeypatch.setattr(bot.session, "make_request", request)
    dp = Dispatcher()
    dp.include_router(build_ingress_router(iw.factory, iw.redis, cfg))
    chat = Chat(bot, dp, request)
    try:
        await chat.feed(text="/connect", chat_type="group")
        await chat.feed(text="/connect", actor=999)
        await chat.feed(text="/connect", actor=999, chat_id=999)
        request.assert_not_called()
        await chat.feed(text="/connect", actor=456, chat_id=456)
        assert "<code>" not in chat.last.text
        await chat.feed(text="/connect")
        match = re.search(r"<code>([A-F0-9]{16})</code>", chat.last.text)
        assert match
        assert chat.last.protect_content
        code = match[1]
    finally:
        await dp.storage.close()
        await bot.session.close()

    results = await asyncio.gather(*(iw.client.post(LOGIN, json={"code": code}) for _ in range(2)))
    assert sorted(response.status_code for response in results) == [200, 401]
    login = next(response for response in results if response.status_code == 200)
    assert login.json()["expires_in"] == 900
    assert login.headers["cache-control"] == "no-store"
    auth = {"X-BCC-Circle-Session": login.json()["session"]}
    iw.app.state.settings.api_key = SecretStr("synthetic-worker-to-api-key")
    assert (await iw.client.get(BASE, headers=auth)).status_code == 401
    auth["X-BCC-API-Key"] = "synthetic-worker-to-api-key"
    assert (await iw.client.get(BASE, headers=auth)).json()["contacts"] == []
    contact = other_contact.json()["contact"]["id"]
    assert (await iw.client.delete(f"{BASE}/{contact}", headers=auth)).status_code == 404
    assert (
        await iw.client.post(
            f"{BASE}/simulator/update",
            headers=auth,
            json={"kind": "consent", "reference": contact, "chat_id": 123},
        )
    ).status_code == 401
    assert (await iw.client.delete(LOGIN, headers=auth)).status_code == 204
    assert (await iw.client.get(BASE, headers=auth)).status_code == 401


async def test_code_expiry_and_owner_enrollment_revocation(iw: IntegrationWorld) -> None:
    assert (await iw.client.get(LOGIN)).status_code == 503
    assert (await iw.client.post(LOGIN, json={"code": "0" * 16})).status_code == 503
    cfg = web_settings(iw)
    assert (await iw.client.get(LOGIN)).json() == {"available": True}
    assert await issue_code(iw.redis, cfg, 456) is None
    code = await issue_code(iw.redis, cfg, 123)
    keys = [key async for key in iw.redis.scan_iter("bcc:circle-web:code:*")]
    assert len(keys) == 1
    assert 0 < await iw.redis.ttl(keys[0]) <= 180
    await iw.redis.expire(keys[0], 0)
    assert (await iw.client.post(LOGIN, json={"code": code})).status_code == 401
    code = await issue_code(iw.redis, cfg, 123)
    login = await iw.client.post(LOGIN, json={"code": code})
    auth = {"X-BCC-Circle-Session": login.json()["session"]}
    assert (await iw.client.get(BASE, headers=auth)).status_code == 200
    cfg.circle_web_owners.clear()
    assert (await iw.client.get(BASE, headers=auth)).status_code == 401
    with pytest.raises(ValidationError):
        IntegrationSettings(**{**cfg.model_dump(), "circle_web_owners": {999: iw.owner.id}})

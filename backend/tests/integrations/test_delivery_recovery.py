import uuid
from datetime import UTC, datetime
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from aiogram import Bot, Dispatcher
from aiogram.exceptions import TelegramRetryAfter
from aiogram.methods import SendMessage
from aiogram.types import Update
from pydantic import SecretStr
from redis.asyncio import Redis
from sqlalchemy import select

from app.integrations.models import IntegrationAudit
from app.integrations.telegram import bot as polling
from app.integrations.telegram.adapter import AiogramTelegramAdapter
from app.integrations.telegram.worker import deliver_one
from tests.integrations.conftest import IntegrationWorld


@pytest.mark.parametrize(
    ("failures", "expected"), [(1, "NOTIFICATION_SENT"), (2, "DELIVERY_FAILED")]
)
async def test_rejected_send_retries_once_without_duplicate(
    iw: IntegrationWorld, failures: int, expected: str
) -> None:
    row = await iw.queue(await iw.verified())
    bot = AsyncMock()
    success = AsyncMock(message_id=42)
    rejected = TelegramRetryAfter(
        method=SendMessage(chat_id=123, text="synthetic"),
        message="provider-private-detail",
        retry_after=0,
    )
    bot.send_message.side_effect = [rejected] * failures + [success]
    adapter = AiogramTelegramAdapter(cast(Bot, bot), [123])
    assert await deliver_one(iw.factory, adapter, iw.cfg)
    assert bot.send_message.await_count == 2
    assert not await deliver_one(iw.factory, adapter, iw.cfg)
    response = await iw.client.get(
        f"/api/v1/trusted-contacts/transactions/{row['transaction_id']}/notifications",
        headers=iw.auth(),
    )
    assert response.json()[0]["state"] == expected
    assert "provider-private-detail" not in response.text
    async with iw.factory() as session:
        events = list(
            await session.scalars(
                select(IntegrationAudit.event).where(
                    IntegrationAudit.resource_id == uuid.UUID(str(row["id"]))
                )
            )
        )
        assert events.count("NOTIFICATION_RETRY") == 1
        assert events.count(expected) == 1


@pytest.mark.parametrize("failure", [TimeoutError("private"), RuntimeError("private")])
async def test_ambiguous_send_is_never_retried(iw: IntegrationWorld, failure: Exception) -> None:
    await iw.queue(await iw.verified())
    bot = AsyncMock()
    bot.send_message.side_effect = failure
    adapter = AiogramTelegramAdapter(cast(Bot, bot), [123])
    assert await deliver_one(iw.factory, adapter, iw.cfg)
    assert not await deliver_one(iw.factory, adapter, iw.cfg)
    assert bot.send_message.await_count == 1


async def test_long_retry_after_does_not_wait_or_resend(iw: IntegrationWorld) -> None:
    await iw.queue(await iw.verified())
    bot = AsyncMock()
    bot.send_message.side_effect = TelegramRetryAfter(
        method=SendMessage(chat_id=123, text="synthetic"),
        message="private",
        retry_after=600,
    )
    assert await deliver_one(iw.factory, AiogramTelegramAdapter(cast(Bot, bot), [123]), iw.cfg)
    assert bot.send_message.await_count == 1
    assert not await deliver_one(iw.factory, AiogramTelegramAdapter(cast(Bot, bot), [123]), iw.cfg)


@pytest.mark.parametrize("failure", ["invalid_input", "redis_unavailable"])
async def test_polling_boundary_does_not_leak_or_crash(
    iw: IntegrationWorld,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    failure: str,
) -> None:
    cfg = iw.cfg.model_copy(
        update={
            "telegram_mode": "test",
            "telegram_allowed_chat_ids": [123],
            "telegram_token": SecretStr("synthetic"),
        }
    )
    # No network: real Dispatcher routing with the Bot HTTP method replaced.
    bot = Bot("123456789:synthetic_test_token_never_used_on_network")
    monkeypatch.setattr(bot.session, "make_request", AsyncMock(return_value=True))
    monkeypatch.setattr(polling, "Bot", lambda _: bot)
    monkeypatch.setattr(polling, "get_integration_settings", lambda: cfg)
    monkeypatch.setattr(polling, "build_engine", lambda _: AsyncMock())
    monkeypatch.setattr(polling, "build_session_factory", lambda _: iw.factory)
    monkeypatch.setattr(Redis, "from_url", lambda _: iw.redis)
    if failure == "redis_unavailable":

        def unavailable(*args: Any, **kwargs: Any) -> None:
            raise RuntimeError("private-redis-credential")

        monkeypatch.setattr(iw.redis, "pipeline", unavailable)

    async def feed(self: Dispatcher, actual_bot: Bot, **kwargs: Any) -> None:
        update = Update.model_validate(
            {
                "update_id": 1,
                "message": {
                    "message_id": 1,
                    "date": datetime.now(UTC),
                    "chat": {"id": 123, "type": "private"},
                    "from": {"id": 123, "is_bot": False, "first_name": "Synthetic"},
                    "text": "/start " + "private-invitation-" * 8,
                    "entities": [{"type": "bot_command", "offset": 0, "length": 6}],
                },
            }
        )
        await self.feed_update(actual_bot, update)

    monkeypatch.setattr(Dispatcher, "start_polling", feed)
    await polling.run()
    assert "private-invitation" not in caplog.text
    assert "private-redis-credential" not in caplog.text
    assert "TELEGRAM_UPDATE_REJECTED" in caplog.text

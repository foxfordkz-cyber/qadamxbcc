import asyncio
import time
import uuid
from typing import cast
from unittest.mock import AsyncMock

import pytest
from aiogram import Bot
from aiogram.exceptions import TelegramForbiddenError
from aiogram.methods import SendMessage

from app.integrations.telegram.adapter import AiogramTelegramAdapter, DeliveryError
from app.integrations.telegram.fake_adapter import FakeTelegramAdapter
from app.integrations.telegram.worker import deliver_one
from tests.integrations.conftest import IntegrationWorld


async def test_fake_adapter_idempotency() -> None:
    fake = FakeTelegramAdapter()
    notification_id = uuid.uuid4()
    first = await fake.send(123, "synthetic", notification_id, "ru")
    assert await fake.send(123, "synthetic", notification_id, "ru") == first
    assert len(fake.messages) == 1


async def test_real_adapter_allowlist_blocks_before_network() -> None:
    bot = AsyncMock()
    adapter = AiogramTelegramAdapter(cast(Bot, bot), [123])
    with pytest.raises(DeliveryError, match="recipient_not_allowlisted"):
        await adapter.send(456, "synthetic", uuid.uuid4(), "ru")
    bot.send_message.assert_not_called()


async def test_real_adapter_error_is_sanitized() -> None:
    bot = AsyncMock()
    bot.send_message.side_effect = TelegramForbiddenError(
        method=SendMessage(chat_id=123, text="synthetic"), message="provider-secret"
    )
    adapter = AiogramTelegramAdapter(cast(Bot, bot), [123])
    with pytest.raises(DeliveryError, match=r"^telegram_api_error$"):
        await adapter.send(123, "synthetic", uuid.uuid4(), "ru")


async def test_real_adapter_callback_payloads_are_bounded() -> None:
    bot = AsyncMock()
    bot.send_message.return_value.message_id = 42
    adapter = AiogramTelegramAdapter(cast(Bot, bot), [123])
    assert await adapter.send(123, "synthetic", uuid.uuid4(), "kk") == "42"
    keyboard = bot.send_message.call_args.kwargs["reply_markup"]
    assert all(len(button.callback_data) <= 64 for button in keyboard.inline_keyboard[0])


class SlowAdapter:
    elapsed: float = 0

    async def send(self, chat_id: int, text: str, notification_id: uuid.UUID, language: str) -> str:
        started = time.perf_counter()
        try:
            await asyncio.sleep(10)
        finally:
            self.elapsed = time.perf_counter() - started
        return "never"


async def test_delivery_timeout_is_bounded(iw: IntegrationWorld) -> None:
    row = await iw.queue(await iw.verified())
    iw.cfg.adapter_timeout_seconds = 0.01
    adapter = SlowAdapter()
    assert await deliver_one(iw.factory, adapter, iw.cfg)
    # Measure provider time independently of PostgreSQL fsync / worker persistence latency.
    assert 0 < adapter.elapsed < 1
    response = await iw.client.get(
        f"/api/v1/trusted-contacts/transactions/{row['transaction_id']}/notifications",
        headers=iw.auth(),
    )
    assert response.json()[0]["state"] == "DELIVERY_FAILED"

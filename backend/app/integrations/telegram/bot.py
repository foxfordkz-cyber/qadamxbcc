"""Opt-in test-only polling ingress. No public webhook trusting caller-supplied Telegram IDs."""

import asyncio
import logging
from typing import Literal

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command
from aiogram.fsm.storage.base import DefaultKeyBuilder
from aiogram.fsm.storage.redis import RedisStorage
from aiogram.types import (
    CallbackQuery,
    ErrorEvent,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from redis.asyncio import Redis

from app.core.config import get_settings
from app.db.session import build_engine, build_session_factory
from app.integrations.config import get_integration_settings
from app.integrations.errors import IntegrationError
from app.integrations.telegram.guardian import build_router
from app.integrations.telegram.handlers import process_update
from app.integrations.telegram.schemas import SimulatedUpdate
from app.integrations.telegram.service import TrustedContactService
from app.integrations.telegram.templates import CONSENT


async def run() -> None:
    cfg = get_integration_settings()
    if not cfg.enabled or cfg.telegram_mode != "test":
        raise RuntimeError("polling requires explicitly configured test Telegram mode")
    core = get_settings()
    engine = build_engine(core.database_url)
    factory = build_session_factory(engine)
    redis: Redis = Redis.from_url(core.redis_url)
    bot = Bot(cfg.telegram_token.get_secret_value())
    router = Router()

    @router.errors()
    async def rejected_update(event: ErrorEvent) -> bool:
        # Never let aiogram's default error logger serialize raw updates, DB details,
        # validation input (including invitations), or provider exception messages.
        logging.getLogger("bcc.integrations").warning(
            "TELEGRAM_UPDATE_REJECTED", extra={"event_code": "TELEGRAM_UPDATE_REJECTED"}
        )
        return True

    async def admitted(chat_id: int) -> bool:
        if chat_id not in cfg.telegram_allowed_chat_ids:
            return False
        async with asyncio.timeout(2), redis.pipeline(transaction=True) as pipe:
            pipe.incr(f"bcc:integrations:bot-rate:{chat_id}")
            pipe.expire(f"bcc:integrations:bot-rate:{chat_id}", 60, nx=True)
            count, _ = await pipe.execute()
        return int(count) <= cfg.rate_limit_per_minute

    router.include_router(build_router(factory, admitted))

    @router.message(Command("start", "revoke"), F.text.contains(" "))
    async def command(message: Message) -> None:
        if (
            message.chat.type != "private"
            or message.from_user is None
            or message.from_user.id != message.chat.id
            or not await admitted(message.chat.id)
        ):
            return
        parts = (message.text or "").split(maxsplit=1)
        if len(parts) != 2:
            return
        kind: Literal["start", "revoke"] = (
            "start" if parts[0].split("@")[0] == "/start" else "revoke"
        )
        async with factory() as session:
            try:
                result = await process_update(
                    TrustedContactService(session, cfg),
                    SimulatedUpdate(
                        kind=kind,
                        chat_id=message.chat.id,
                        reference=parts[1],
                    ),
                )
            except IntegrationError:
                await message.answer("Недействительный запрос / Жарамсыз сұрау")
                return
        if kind == "start":
            await message.answer(
                CONSENT,
                reply_markup=InlineKeyboardMarkup(
                    inline_keyboard=[
                        [
                            InlineKeyboardButton(
                                text="Согласен / Келісемін",
                                callback_data=f"consent:{result.resource_id}",
                            ),
                            InlineKeyboardButton(
                                text="Отказ / Бас тарту",
                                callback_data=f"revoke:{result.resource_id}",
                            ),
                        ]
                    ]
                ),
            )
        else:
            await message.answer("Согласие отозвано / Келісім қайтарылды")

    @router.callback_query(~F.data.startswith("g:"))
    async def callback(query: CallbackQuery) -> None:
        message = query.message
        if (
            not isinstance(message, Message)
            or message.chat.type != "private"
            or query.from_user.id != message.chat.id
            or not await admitted(message.chat.id)
        ):
            return
        parts = (query.data or "").split(":", 1)
        if len(parts) != 2 or parts[0] not in {"consent", "revoke", "ack", "suspect"}:
            return
        update = SimulatedUpdate.model_validate(
            {
                "kind": parts[0],
                "reference": parts[1],
                "chat_id": message.chat.id,
                "message_id": str(message.message_id),
            }
        )
        async with factory() as session:
            try:
                await process_update(TrustedContactService(session, cfg), update)
            except IntegrationError:
                await query.answer("Недействительный запрос / Жарамсыз сұрау")
                return
        await query.answer("Принято / Қабылданды")

    storage = RedisStorage(
        redis, key_builder=DefaultKeyBuilder(with_bot_id=True), state_ttl=900, data_ttl=900
    )
    dispatcher = Dispatcher(storage=storage, events_isolation=storage.create_isolation())
    dispatcher.include_router(router)
    try:
        await dispatcher.start_polling(bot, allowed_updates=["message", "callback_query"])
    finally:
        await bot.session.close()
        await redis.aclose()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())

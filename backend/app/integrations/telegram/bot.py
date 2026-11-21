"""Opt-in test-only polling ingress. No public webhook trusting caller-supplied Telegram IDs."""

import asyncio
import logging
import re
from contextlib import suppress
from typing import Literal

from aiogram import Bot, Dispatcher, F, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
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
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.db.session import build_engine, build_session_factory
from app.integrations.config import IntegrationSettings, get_integration_settings
from app.integrations.errors import IntegrationError
from app.integrations.telegram.assistant_ui import configure_commands
from app.integrations.telegram.assistant_ui import language as preferred_language
from app.integrations.telegram.guardian import TEXT, build_router, keyboard, menu
from app.integrations.telegram.handlers import process_update
from app.integrations.telegram.polling_lock import PollingLock
from app.integrations.telegram.schemas import SimulatedUpdate
from app.integrations.telegram.service import TrustedContactService
from app.integrations.telegram.templates import CONSENT, STATE_LABELS
from app.integrations.telegram.web_session import issue_code


def build_ingress_router(
    factory: async_sessionmaker[AsyncSession], redis: Redis, cfg: IntegrationSettings
) -> Router:
    """The same ingress is exercised offline by dispatcher tests and by authorized polling."""
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

    @router.message(Command("connect"))
    async def connect(message: Message) -> None:
        if (
            message.chat.type != "private"
            or message.from_user is None
            or message.from_user.id != message.chat.id
            or not await admitted(message.chat.id)
        ):
            return
        code = await issue_code(redis, cfg, message.chat.id)
        if code is None:
            await message.answer(
                "Для этого чата веб-доступ не подключён. / Бұл чатқа веб-кіру қосылмаған."
            )
            return
        await message.answer(
            f"<code>{code}</code>\n\nВведите код в разделе «Доверенные люди» Saq Bol × BCC. "
            "Он действует 3 минуты и открывает управление вашим кругом. Храните его в тайне."
            "\n\nКодты Saq Bol × BCC қолданбасындағы «Сенімді адамдар» бөліміне енгізіңіз. "
            "Код 3 минут жарамды және өз тобыңызды басқаруға мүмкіндік береді. "
            "Кодты құпия сақтаңыз.",
            parse_mode="HTML",
            protect_content=True,
        )

    @router.message(Command("start", "revoke"), F.text.regexp(r"^/\S+\s+\S"))
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
        # A private test enrollment opens the assistant only after the operator
        # has added this chat to the allowlist. It grants no contact consent.
        if kind == "start" and re.fullmatch(r"guardian_[A-Za-z0-9_-]{22}", parts[1]):
            await message.answer(
                TEXT["ru"]["welcome"] + "\n\n" + TEXT["kk"]["welcome"],
                reply_markup=keyboard([("Русский", "ru"), ("Қазақша", "kk")]),
            )
            return
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

    @router.callback_query(
        ~(F.data.startswith("g:") | F.data.startswith("r:") | F.data.startswith("s:"))
    )
    async def callback(query: CallbackQuery, state: FSMContext) -> None:
        message = query.message
        if (
            not isinstance(message, Message)
            or message.chat.type != "private"
            or query.from_user.id != message.chat.id
            or not await admitted(message.chat.id)
        ):
            return
        parts = (query.data or "").split(":", 1)
        if len(parts) != 2 or parts[0] not in {"consent", "revoke", "ack", "suspect", "approve"}:
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
                service = TrustedContactService(session, cfg)
                result = await process_update(service, update)
                language = "ru"
                if result.state == "CONTACT_VERIFIED":
                    contact = await service.get_contact(result.resource_id)
                    language = preferred_language(
                        (await state.get_data()).get("language", contact.language)
                    )
            except IntegrationError:
                await query.answer("Недействительный запрос / Жарамсыз сұрау")
                return
        await query.answer("Принято / Қабылданды")
        labels = STATE_LABELS.get(result.state, ("Согласие подтверждено", "Келісім расталды"))
        marker = "\n\nСтатус / Күй: "
        text = (message.text or "").split(marker)[0] + marker + " / ".join(labels)
        markup = (
            None
            if result.state in {"CONTACT_REVOKED", "SUSPICION_REPORTED"}
            else message.reply_markup
        )
        if result.state == "CONTACT_VERIFIED":
            # Finish onboarding in the same message; do not leave the user on consent buttons.
            await state.set_data({"language": language})
            text = " / ".join(labels) + "\n\n" + TEXT[language]["welcome"]
            markup = menu(language)
        elif result.state == "CONTACT_REVOKED":
            markup = InlineKeyboardMarkup(
                inline_keyboard=[
                    [
                        InlineKeyboardButton(
                            text="Главное меню / Басты мәзір", callback_data="g:home"
                        )
                    ]
                ]
            )
        with suppress(TelegramBadRequest):
            await message.edit_text(text, reply_markup=markup, parse_mode=None)

    return router


async def run(*, embedded: bool = False) -> None:
    cfg = get_integration_settings()
    if not cfg.enabled or cfg.telegram_mode != "test":
        raise RuntimeError("polling requires explicitly configured test Telegram mode")
    core = get_settings()
    engine = build_engine(core.database_url)
    factory = build_session_factory(engine)
    redis: Redis = Redis.from_url(core.redis_url)
    bot = Bot(cfg.telegram_token.get_secret_value())
    storage = RedisStorage(
        redis, key_builder=DefaultKeyBuilder(with_bot_id=True), state_ttl=900, data_ttl=900
    )
    dispatcher = Dispatcher(storage=storage, events_isolation=storage.create_isolation())
    dispatcher.include_router(build_ingress_router(factory, redis, cfg))
    polling_lock: PollingLock | None = None
    try:
        polling_lock = PollingLock(bot.id)
        polling_lock.acquire()
        await configure_commands(bot)
        if embedded:
            # Uvicorn owns process signals. Let aiogram stop its own internal
            # polling task before closing sessions or handing off ownership.
            polling = asyncio.create_task(
                dispatcher.start_polling(
                    bot,
                    handle_signals=False,
                    handle_as_tasks=False,
                    allowed_updates=["message", "callback_query"],
                )
            )
            try:
                await asyncio.shield(polling)
            finally:
                if not polling.done():
                    try:
                        await dispatcher.stop_polling()
                    except RuntimeError:  # Cancelled before the dispatcher acquired its lock.
                        polling.cancel()
                    await asyncio.gather(polling, return_exceptions=True)
        else:
            await dispatcher.start_polling(bot, allowed_updates=["message", "callback_query"])
    finally:
        if polling_lock:
            polling_lock.close()
        await bot.session.close()
        await redis.aclose()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())

from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import pytest
from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import SimpleEventIsolation
from aiogram.types import Update

from app.integrations.telegram.guardian import QUESTIONS, TEXT, build_router, recipient_view
from app.schemas.transfers import CoolingQuestionnaire
from tests.integrations.conftest import IntegrationWorld


@pytest.mark.parametrize("language", ["ru", "kk"])
async def test_guardian_navigation_and_survey(
    iw: IntegrationWorld, language: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    bot = Bot("123456789:synthetic_test_token_never_used_on_network")
    request = AsyncMock(return_value=True)
    monkeypatch.setattr(bot.session, "make_request", request)
    dp = Dispatcher(events_isolation=SimpleEventIsolation())
    dp.include_router(build_router(iw.factory, AsyncMock(return_value=True)))
    counter = 0

    async def feed(action: str | None = None) -> None:
        nonlocal counter
        counter += 1
        message: dict[str, Any] = {
            "message_id": 10,
            "date": datetime.now(UTC),
            "chat": {"id": 123, "type": "private"},
            "from": {"id": 123, "is_bot": False, "first_name": "Synthetic"},
            "text": "/start",
            "entities": [{"type": "bot_command", "offset": 0, "length": 6}],
        }
        value: dict[str, Any] = {"update_id": counter}
        if action is None:
            value["message"] = message
        else:
            value["callback_query"] = {
                "id": str(counter),
                "from": message["from"],
                "chat_instance": "test",
                "data": action,
                "message": message,
            }
        await dp.feed_update(bot, Update.model_validate(value))

    try:
        await feed()
        await feed("g:" + language)
        for page in ("security", "alerts", "contacts", "history", "help", "language"):
            await feed("g:" + page)
            await feed("g:home")
        await feed("g:scam")
        first = ""
        for i in range(5):
            method = request.call_args.args[1]
            action = method.reply_markup.inline_keyboard[0][0].callback_data
            if i == 0:
                first = action
            await feed(action)
        assert TEXT[language]["result"] in request.call_args.args[1].text
        await feed(first)
        assert any(TEXT[language]["stale"] in str(c) for c in request.call_args_list)
        await feed("g:draft")
        assert TEXT[language]["draft_text"] == request.call_args.args[1].text
        await feed("g:home")
        await feed(first)
        assert all(getattr(c.args[1], "parse_mode", None) is None for c in request.call_args_list)
    finally:
        await dp.storage.close()
        await bot.session.close()


async def test_recipient_view_rechecks_consent_and_identity(iw: IntegrationWorld) -> None:
    contact = await iw.verified()
    await iw.queue(contact)
    own = await recipient_view(iw.factory, 123, "security", "ru")
    assert "Активных согласий: 1" in own
    assert TEXT["ru"]["empty"] in await recipient_view(iw.factory, 456, "alerts", "ru")
    await iw.client.delete(f"/api/v1/trusted-contacts/{contact}", headers=iw.auth())
    assert TEXT["ru"]["empty"] in await recipient_view(iw.factory, 123, "history", "ru")


def test_guardian_reuses_core_question_fields_and_complete_locales() -> None:
    assert {q[0] for q in QUESTIONS} == set(CoolingQuestionnaire.model_fields)
    assert set(TEXT["ru"]) == set(TEXT["kk"])
    assert all(v.strip() for language in TEXT.values() for v in language.values())


@pytest.mark.parametrize(
    ("chat_type", "sender", "allowed"),
    [("group", 123, True), ("private", 456, True), ("private", 123, False)],
)
async def test_guardian_ingress_boundary(
    iw: IntegrationWorld,
    chat_type: str,
    sender: int,
    allowed: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bot = Bot("123456789:synthetic_test_token_never_used_on_network")
    request = AsyncMock(return_value=True)
    monkeypatch.setattr(bot.session, "make_request", request)
    dp = Dispatcher()
    dp.include_router(build_router(iw.factory, AsyncMock(return_value=allowed)))
    try:
        await dp.feed_update(
            bot,
            Update.model_validate(
                {
                    "update_id": 1,
                    "message": {
                        "message_id": 1,
                        "date": datetime.now(UTC),
                        "chat": {"id": 123, "type": chat_type},
                        "from": {"id": sender, "is_bot": False, "first_name": "Synthetic"},
                        "text": "/start",
                        "entities": [{"type": "bot_command", "offset": 0, "length": 6}],
                    },
                }
            ),
        )
        request.assert_not_called()
    finally:
        await bot.session.close()

from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import pytest
from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import SimpleEventIsolation
from aiogram.types import Update
from sqlalchemy import func, select

from app.integrations.models import GuardianReport
from app.integrations.telegram.guardian import build_router
from app.integrations.telegram.guardian_reports import COPY
from tests.integrations.conftest import IntegrationWorld


@pytest.mark.parametrize("language", ["ru", "kk"])
async def test_bot_report_confirmation_soc_and_revocation(
    iw: IntegrationWorld, monkeypatch: pytest.MonkeyPatch, language: str
) -> None:
    cid = await iw.verified()
    bot = Bot("123456789:synthetic_test_token_never_used_on_network")
    request = AsyncMock(return_value=True)
    monkeypatch.setattr(bot.session, "make_request", request)
    dp = Dispatcher(events_isolation=SimpleEventIsolation())
    dp.include_router(build_router(iw.factory, AsyncMock(return_value=True)))
    counter = 0

    async def feed(action: str | None = None, text: str = "/start", actor: int = 123) -> None:
        nonlocal counter
        counter += 1
        user = {"id": actor, "is_bot": False, "first_name": "Synthetic"}
        message: dict[str, Any] = {
            "message_id": 10,
            "date": datetime.now(UTC),
            "chat": {"id": actor, "type": "private"},
            "from": user,
            "text": text,
        }
        if text.startswith("/"):
            message["entities"] = [{"type": "bot_command", "offset": 0, "length": len(text)}]
        value: dict[str, Any] = {"update_id": counter}
        if action:
            value["callback_query"] = {
                "id": str(counter),
                "from": user,
                "chat_instance": "test",
                "message": message,
                "data": action,
            }
        else:
            value["message"] = message
        await dp.feed_update(bot, Update.model_validate(value))

    try:
        await feed()
        await feed("g:" + language)
        await feed("g:scam")
        for _ in range(5):
            action = request.call_args.args[1].reply_markup.inline_keyboard[0][0].callback_data
            await feed(action)
        await feed("g:draft")
        await feed("r:begin")
        await feed("r:contact:" + cid)
        await feed("r:category:other")
        await feed("g:help")
        calls_before_cancelled_text = request.call_count
        await feed(text="This cancelled draft must not be captured.")
        assert request.call_count == calls_before_cancelled_text
        await feed("r:begin")
        await feed("r:contact:" + cid)
        await feed("r:category:impersonation")
        await feed(text="The caller requested OTP 123456")
        assert request.call_args.args[1].text == COPY[language]["invalid"]
        description = "A caller claimed to work for the bank and requested urgent action."
        await feed(text=description)
        assert COPY[language]["preview"] in request.call_args.args[1].text
        async with iw.factory() as session:
            assert await session.scalar(select(func.count()).select_from(GuardianReport)) == 0
        await feed("r:submit")
        async with iw.factory() as session:
            rows = list(await session.scalars(select(GuardianReport)))
            assert len(rows) == 1
            rid = str(rows[0].id)
            assert rows[0].description == description
        await feed("r:submit")
        async with iw.factory() as session:
            assert await session.scalar(select(func.count()).select_from(GuardianReport)) == 1
        base = "/api/v1/integrations/guardian/reports/" + rid
        assert (await iw.client.get(base, headers=iw.auth("soc"))).status_code == 200
        await iw.client.post(base + "/acknowledge", headers=iw.auth("soc"))
        await feed("r:status:" + rid)
        assert COPY[language]["reviewed"] in request.call_args.args[1].text
        await feed("r:status:" + rid, actor=456)
        assert rid not in request.call_args.args[1].text
        await iw.client.delete("/api/v1/trusted-contacts/" + cid, headers=iw.auth())
        await feed("r:status:" + rid)
        assert request.call_args.args[1].text == COPY[language]["error"]
    finally:
        await dp.storage.close()
        await bot.session.close()

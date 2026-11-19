"""Real aiogram dispatcher and SQL lifecycle, with Telegram transport fully replaced."""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest
from aiogram import Bot, Dispatcher
from aiogram.exceptions import TelegramBadRequest, TelegramRetryAfter
from aiogram.fsm.storage.memory import SimpleEventIsolation
from aiogram.methods import EditMessageText, SendMessage, SetMyCommands
from aiogram.types import InlineKeyboardMarkup, Update
from sqlalchemy import func, select

from app.db.base import utcnow
from app.integrations.models import ContactNotification, GuardianReport, TrustedContact
from app.integrations.telegram.assistant_ui import COMMANDS, COPY, configure_commands, display
from app.integrations.telegram.bot import build_ingress_router
from app.integrations.telegram.guardian import TEXT, menu
from app.integrations.telegram.guardian_reports import COPY as REPORT
from app.integrations.telegram.recipient_pages import (
    dashboard,
    notification_detail,
    notification_page,
    page_number,
    report_page,
)
from app.integrations.telegram.scam_check import COPY as SCAN
from app.models import Transaction
from tests.integrations.conftest import IntegrationWorld


@dataclass
class Chat:
    bot: Bot
    dp: Dispatcher
    request: AsyncMock
    counter: int = 0

    @property
    def last(self) -> Any:
        return self.request.call_args.args[1]

    def action(self, prefix: str) -> str:
        return next(
            str(b.callback_data)
            for row in self.last.reply_markup.inline_keyboard
            for b in row
            if (b.callback_data or "").startswith(prefix)
        )

    async def feed(
        self,
        action: str | None = None,
        *,
        text: str = "/menu",
        actor: int = 123,
        chat_id: int = 123,
        chat_type: str = "private",
        media: bool = False,
    ) -> None:
        self.counter += 1
        user = {"id": actor, "is_bot": False, "first_name": "Synthetic"}
        message: dict[str, Any] = {
            "message_id": 10,
            "date": datetime.now(UTC),
            "chat": {"id": chat_id, "type": chat_type},
            "from": user,
        }
        if media:
            message["document"] = {"file_id": "synthetic", "file_unique_id": "offline"}
        else:
            message["text"] = text
            if text.startswith("/"):
                message["entities"] = [
                    {"type": "bot_command", "offset": 0, "length": len(text.split()[0])}
                ]
        value: dict[str, Any] = {"update_id": self.counter}
        if action is None:
            value["message"] = message
        else:
            value["callback_query"] = {
                "id": str(self.counter),
                "from": user,
                "chat_instance": "synthetic",
                "data": action,
                "message": message,
            }
        await self.dp.feed_update(self.bot, Update.model_validate(value))


@pytest.fixture
async def chat(iw: IntegrationWorld, monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[Chat]:
    bot = Bot("123456789:synthetic_test_token_never_used_on_network")
    request = AsyncMock(return_value=True)
    monkeypatch.setattr(bot.session, "make_request", request)
    dp = Dispatcher(events_isolation=SimpleEventIsolation())
    cfg = iw.cfg.model_copy(update={"telegram_allowed_chat_ids": [123]})
    dp.include_router(build_ingress_router(iw.factory, iw.redis, cfg))
    try:
        yield Chat(bot, dp, request)
    finally:
        await dp.storage.close()
        await bot.session.close()


@pytest.mark.parametrize("lang", ["ru", "kk"])
async def test_private_commands_and_direct_menu_paths(
    iw: IntegrationWorld, chat: Chat, lang: str
) -> None:
    await iw.verified()
    await chat.feed(text="/start")
    await chat.feed("g:" + lang)
    actions = {b.callback_data for row in chat.last.reply_markup.inline_keyboard for b in row}
    assert {"r:begin", "r:list", "g:safety", "g:privacy", "g:scam"} <= actions
    expectations = {
        "menu": TEXT[lang]["welcome"],
        "status": COPY[lang]["dashboard"],
        "notifications": COPY[lang]["notifications"],
        "contacts": TEXT[lang]["scope"],
        "check": TEXT[lang]["survey"],
        "report": REPORT[lang]["choose"],
        "reports": COPY[lang]["reports"],
        "privacy": COPY[lang]["privacy_text"],
        "safety": COPY[lang]["safety_text"],
        "help": TEXT[lang]["help_text"],
        "language": TEXT[lang]["welcome"],
        "cancel": COPY[lang]["cancelled"],
    }
    for command, expected in expectations.items():
        await chat.feed(text="/" + command)
        assert isinstance(chat.last, SendMessage)
        assert expected in chat.last.text
        assert len(chat.last.text) <= 4096
        assert isinstance(chat.last.reply_markup, InlineKeyboardMarkup)
        for row in chat.last.reply_markup.inline_keyboard:
            for button in row:
                assert button.callback_data is not None
                assert len(button.callback_data.encode()) <= 64
    async with iw.factory() as session:
        assert await session.scalar(select(func.count()).select_from(GuardianReport)) == 0


@pytest.mark.parametrize("separator", [" ", "\t"])
async def test_invitation_consent_and_menu_revoke_through_polling_router(
    iw: IntegrationWorld, chat: Chat, separator: str
) -> None:
    invite = await iw.invite()
    await chat.feed(text="/start" + separator + str(invite["invitation_token"]))
    consent = chat.action("consent:")
    await chat.feed(consent)
    assert "Согласие подтверждено" in chat.last.text
    assert chat.action("g:security") == "g:security"
    assert chat.action("r:begin") == "r:begin"
    assert all(
        not (b.callback_data or "").startswith("consent:")
        for row in chat.last.reply_markup.inline_keyboard
        for b in row
    )
    # Consent changes only this message; no second send is introduced by onboarding.
    assert isinstance(chat.last, EditMessageText)
    await chat.feed(text="/contacts")
    await chat.feed(chat.action("g:revoke:"))
    confirm = chat.action("revoke:")
    # Merely opening the confirmation never revokes.
    async with iw.factory() as session:
        row = await session.get(TrustedContact, uuid.UUID(consent.split(":")[1]))
        assert row is not None
        assert row.state == "CONTACT_VERIFIED"
    await chat.feed(confirm)
    assert chat.action("g:home") == "g:home"
    async with iw.factory() as session:
        row = await session.get(TrustedContact, uuid.UUID(consent.split(":")[1]))
        assert row is not None
        assert row.state == "CONTACT_REVOKED"
        assert row.telegram_chat_id is None
    await chat.feed(consent)
    await chat.feed(text="/start " + str(invite["invitation_token"]))
    assert "Недействительный запрос" in chat.last.text


async def test_cancel_clears_drafts_and_rejects_old_question(chat: Chat) -> None:
    await chat.feed("g:kk")
    await chat.feed(text="/check")
    old_answer = chat.action("g:a:")
    await chat.feed(text="/cancel")
    state = await chat.dp.fsm.get_context(bot=chat.bot, chat_id=123, user_id=123).get_data()
    assert state == {"language": "kk"}
    await chat.feed(old_answer)
    assert chat.last.text == TEXT["kk"]["stale"]
    await chat.feed(text="/privacy")
    assert chat.last.text == COPY["kk"]["privacy_text"]


async def test_first_consent_opens_menu_in_invitation_language(
    iw: IntegrationWorld, chat: Chat
) -> None:
    invitation = await iw.invite("kk")
    await chat.feed(text="/start " + str(invitation["invitation_token"]))
    await chat.feed(chat.action("consent:"))
    assert TEXT["kk"]["welcome"] in chat.last.text
    assert chat.action("g:security") == "g:security"
    state = await chat.dp.fsm.get_context(bot=chat.bot, chat_id=123, user_id=123).get_data()
    assert state == {"language": "kk"}


async def test_stale_confirmation_cannot_submit_a_different_preview(
    iw: IntegrationWorld, chat: Chat
) -> None:
    cid = await iw.verified()

    async def prepare(description: str) -> tuple[str, str]:
        await chat.feed(text="/report")
        await chat.feed(chat.action("r:contact:"))
        category = chat.action("r:category:")
        await chat.feed(category)
        await chat.feed(text=description)
        assert REPORT["ru"]["preview"] in chat.last.text
        return category, chat.action("r:submit:")

    old_category, old_submit = await prepare("A synthetic caller asked for an urgent transfer.")
    await chat.feed(text="/cancel")
    category, submit = await prepare("Another synthetic caller requested remote access.")
    assert old_submit != submit
    await chat.feed(old_category)
    assert chat.last.text == REPORT["ru"]["error"]
    await chat.feed(old_submit)
    assert chat.last.text == REPORT["ru"]["error"]
    await chat.feed("r:submit")
    assert chat.last.text == REPORT["ru"]["error"]
    async with iw.factory() as session:
        assert await session.scalar(select(func.count()).select_from(GuardianReport)) == 0
    # Editing category invalidates the preview, including the current confirmation.
    await chat.feed(category)
    await chat.feed(submit)
    assert chat.last.text == REPORT["ru"]["error"]
    await chat.feed(text="A third synthetic caller requested a secret transfer.")
    fresh = chat.action("r:submit:")
    await chat.feed(fresh)
    await chat.feed(fresh)
    async with iw.factory() as session:
        rows = list(await session.scalars(select(GuardianReport)))
        assert len(rows) == 1
        assert str(rows[0].contact_id) == cid
        assert "third synthetic" in (rows[0].description or "")


async def test_fallback_does_not_echo_persist_or_download_input(
    iw: IntegrationWorld, chat: Chat
) -> None:
    for text in ("Unsolicited private text must never be echoed", "/unknown"):
        await chat.feed(text=text)
        assert chat.last.text == COPY["ru"]["fallback"]
        assert text not in chat.last.text
    await chat.feed(media=True)
    assert chat.last.text == COPY["ru"]["fallback"]
    assert all(isinstance(c.args[1], SendMessage) for c in chat.request.call_args_list)
    assert await chat.dp.fsm.get_context(bot=chat.bot, chat_id=123, user_id=123).get_data() == {}
    async with iw.factory() as session:
        assert await session.scalar(select(func.count()).select_from(GuardianReport)) == 0


async def test_expired_report_preview_never_submits(iw: IntegrationWorld, chat: Chat) -> None:
    await iw.verified()
    await chat.feed(text="/report")
    await chat.feed(chat.action("r:contact:"))
    await chat.feed(chat.action("r:category:"))
    await chat.feed(text="A synthetic caller requested a secret payment.")
    submit = chat.action("r:submit:")
    state = chat.dp.fsm.get_context(bot=chat.bot, chat_id=123, user_id=123)
    await state.update_data(report_expires=0)
    await chat.feed(submit)
    assert chat.last.text == REPORT["ru"]["error"]
    async with iw.factory() as session:
        assert await session.scalar(select(func.count()).select_from(GuardianReport)) == 0


async def test_redis_failure_and_quota_fail_closed_without_secret_logs(
    iw: IntegrationWorld,
    chat: Chat,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with monkeypatch.context() as patch:
        patch.setattr(
            iw.redis, "pipeline", Mock(side_effect=ConnectionError("private redis detail"))
        )
        await chat.feed(text="/privacy")
    chat.request.assert_not_called()
    assert "TELEGRAM_UPDATE_REJECTED" in caplog.text
    assert "private redis detail" not in caplog.text
    await iw.redis.set("bcc:integrations:bot-rate:123", 300, ex=60)
    await chat.feed(text="/status")
    chat.request.assert_not_called()
    await iw.redis.delete("bcc:integrations:bot-rate:123")
    await chat.feed(text="/privacy")
    assert chat.request.call_count == 1
    assert chat.last.text == COPY["ru"]["privacy_text"]


@pytest.mark.parametrize(
    ("chat_type", "actor", "chat_id"),
    [("group", 123, 123), ("private", 456, 123), ("private", 456, 456)],
)
async def test_assistant_ingress_rejects_non_private_or_unapproved(
    chat: Chat, chat_type: str, actor: int, chat_id: int
) -> None:
    for text in ("/status", "/report", "/privacy", "unsolicited"):
        await chat.feed(text=text, actor=actor, chat_id=chat_id, chat_type=chat_type)
    await chat.feed("g:alerts", actor=actor, chat_id=chat_id, chat_type=chat_type)
    chat.request.assert_not_called()


async def test_notification_pagination_details_and_revocation(iw: IntegrationWorld) -> None:
    cid = await iw.verified()
    queued = await iw.queue(cid)
    async with iw.factory() as session:
        initial = await session.get(ContactNotification, uuid.UUID(str(queued["id"])))
        assert initial is not None
        tx = await session.get(Transaction, initial.transaction_id)
        assert tx is not None
        values = {
            column.name: getattr(tx, column.name)
            for column in Transaction.__table__.columns
            if column.name != "id"
        }
        for n in range(5):
            copied = Transaction(id=uuid.uuid4(), **values)
            session.add(copied)
            await session.flush()
            session.add(
                ContactNotification(
                    owner_id=iw.owner.id,
                    contact_id=uuid.UUID(cid),
                    transaction_id=copied.id,
                    state="NOTIFICATION_SENT" if n == 0 else "CONTACT_ACKNOWLEDGED",
                    expires_at=utcnow() + timedelta(minutes=10),
                )
            )
        await session.commit()
    first_text, first = await notification_page(iw.factory, 123, "kk")
    _, second = await notification_page(iw.factory, 123, "kk", 1)
    first_ids = {
        b.callback_data
        for r in first.inline_keyboard
        for b in r
        if (b.callback_data or "").startswith("g:notification:")
    }
    second_ids = {
        b.callback_data
        for r in second.inline_keyboard
        for b in r
        if (b.callback_data or "").startswith("g:notification:")
    }
    assert len(first_ids) == 5
    assert len(second_ids) == 1
    assert not first_ids & second_ids
    assert "Telegram API" in first_text
    assert "Ожидают подтверждения получения: 1" in await dashboard(iw.factory, 123, "ru")
    own, _ = await notification_detail(iw.factory, 123, "ru", str(queued["id"]))
    assert COPY["ru"]["original"] in own
    denied, _ = await notification_detail(iw.factory, 456, "ru", str(queued["id"]))
    malformed, _ = await notification_detail(iw.factory, 123, "ru", "not-a-uuid")
    assert denied == malformed == COPY["ru"]["unavailable"]
    await iw.client.delete("/api/v1/trusted-contacts/" + cid, headers=iw.auth())
    revoked, _ = await notification_detail(iw.factory, 123, "ru", str(queued["id"]))
    assert revoked == denied
    text, _ = await notification_page(iw.factory, 123, "ru")
    assert COPY["ru"]["empty"] in text


async def test_report_history_buttons_filter_expiry_owner_and_consent(
    iw: IntegrationWorld, chat: Chat
) -> None:
    cid = await iw.verified()
    async with iw.factory() as session:
        for n in range(8):
            session.add(
                GuardianReport(
                    owner_id=iw.owner.id,
                    contact_id=uuid.UUID(cid) if n < 7 else None,
                    category="other",
                    description="Synthetic report for recipient history.",
                    idempotency_key=uuid.uuid4(),
                    content_hash=f"synthetic-{n}",
                    expires_at=utcnow() + timedelta(days=1 if n != 6 else -1),
                )
            )
        await session.commit()
        _, one = await report_page(session, 123, "ru")
        _, two = await report_page(session, 123, "ru", 1)
    ids_one = {
        b.callback_data
        for r in one.inline_keyboard
        for b in r
        if (b.callback_data or "").startswith("r:status:")
    }
    ids_two = {
        b.callback_data
        for r in two.inline_keyboard
        for b in r
        if (b.callback_data or "").startswith("r:status:")
    }
    assert len(ids_one) == 5
    assert len(ids_two) == 1
    assert not ids_one & ids_two
    status = str(next(iter(ids_one)))
    await chat.feed(text="/reports")
    await chat.feed(status)
    assert REPORT["ru"]["submitted"] in chat.last.text
    await chat.feed("r:list:1")
    assert "Страница 2" in chat.last.text
    await iw.client.delete("/api/v1/trusted-contacts/" + cid, headers=iw.auth())
    await chat.feed(status)
    assert chat.last.text == REPORT["ru"]["error"]
    await chat.feed(text="/reports")
    assert COPY["ru"]["empty"] in chat.last.text


@pytest.mark.parametrize("value", ["-1", "20", "999999", "1.0", "١", ""])
def test_pagination_rejects_invalid_or_unbounded_input(value: str) -> None:
    with pytest.raises(ValueError, match="invalid recipient page"):
        page_number(value)


async def test_command_registration_private_localized_and_no_sends(chat: Chat) -> None:
    await configure_commands(chat.bot)
    methods = [c.args[1] for c in chat.request.call_args_list]
    assert len(methods) == 4
    for method, lang in zip(methods[:3], ("", "ru", "kk"), strict=True):
        assert isinstance(method, SetMyCommands)
        assert method.language_code == lang
        assert method.scope is not None
        assert method.scope.type == "all_private_chats"
        assert {c.command for c in method.commands} == set(COMMANDS)
        assert all(1 <= len(c.description) <= 256 for c in method.commands)
    assert set(COPY["ru"]) == set(COPY["kk"])
    assert all(value.strip() for lang in COPY.values() for value in lang.values())


@pytest.mark.parametrize("lang", ["ru", "kk"])
async def test_private_scan_menu_language_and_no_raw_persistence(chat: Chat, lang: str) -> None:
    await chat.feed("g:" + lang)
    await chat.feed("s:begin")
    assert chat.last.text == SCAN[lang]["prompt"]
    state = chat.dp.fsm.get_context(bot=chat.bot, chat_id=123, user_id=123)
    assert set(await state.get_data()) == {"language", "scan_expires"}
    await chat.feed(text="Переведите деньги на безопасный счет. SYNTHETIC_SECRET")
    assert SCAN[lang]["signals_detected"] in chat.last.text
    assert "SYNTHETIC_SECRET" not in chat.last.text
    assert await state.get_data() == {"language": lang}
    assert chat.last.parse_mode is None
    await chat.feed(text="SYNTHETIC_SECRET")
    assert chat.last.text == COPY[lang]["fallback"]


@pytest.mark.parametrize("stop", ["/cancel", "/menu", "/check", "/report"])
async def test_scan_is_invalidated_when_leaving_flow(chat: Chat, stop: str) -> None:
    await chat.feed(text="/scan")
    await chat.feed(text=stop)
    state = await chat.dp.fsm.get_context(bot=chat.bot, chat_id=123, user_id=123).get_data()
    assert "scan_expires" not in state
    await chat.feed(text="Переведите деньги на безопасный счет. SYNTHETIC_SECRET")
    assert SCAN["ru"]["signals_detected"] not in chat.last.text
    assert "SYNTHETIC_SECRET" not in chat.last.text


async def test_scan_expiry_and_oversized_text_do_not_echo(chat: Chat) -> None:
    await chat.feed(text="/scan")
    state = chat.dp.fsm.get_context(bot=chat.bot, chat_id=123, user_id=123)
    await state.update_data(scan_expires=1)
    await chat.feed(text="SYNTHETIC_SECRET")
    assert chat.last.text == SCAN["ru"]["expired"]
    await chat.feed(text="/scan")
    await chat.feed(text="SYNTHETIC_SECRET" * 200)
    assert chat.last.text == SCAN["ru"]["invalid"]
    assert await state.get_data() == {"language": "ru"}


@pytest.mark.parametrize(
    ("chat_type", "actor", "chat_id"),
    [("group", 123, 123), ("private", 456, 123), ("private", 456, 456)],
)
async def test_scan_rejects_unapproved_surfaces(
    chat: Chat, chat_type: str, actor: int, chat_id: int
) -> None:
    await chat.feed(text="/scan", actor=actor, chat_id=chat_id, chat_type=chat_type)
    await chat.feed("s:begin", actor=actor, chat_id=chat_id, chat_type=chat_type)
    chat.request.assert_not_called()


async def test_command_registration_failure_is_bounded_and_redacted(
    chat: Chat, caplog: pytest.LogCaptureFixture
) -> None:
    chat.request.side_effect = TelegramRetryAfter(
        method=SetMyCommands(commands=[]), message="private provider detail", retry_after=600
    )
    await configure_commands(chat.bot)
    assert chat.request.call_count == 1
    assert "TELEGRAM_COMMAND_MENU_UNAVAILABLE" in caplog.text
    assert "private provider detail" not in caplog.text


async def test_failed_menu_edit_never_becomes_a_second_send(chat: Chat) -> None:
    from aiogram.types import Message

    message = Message.model_validate(
        {"message_id": 10, "date": datetime.now(UTC), "chat": {"id": 123, "type": "private"}}
    ).as_(chat.bot)
    chat.request.side_effect = TelegramBadRequest(
        method=EditMessageText(text="synthetic"), message="message is not modified"
    )
    await display(message, "synthetic", menu("ru"), edit=True)
    assert chat.request.call_count == 1
    assert isinstance(chat.last, EditMessageText)
    chat.request.reset_mock()
    chat.request.side_effect = TimeoutError
    with pytest.raises(TimeoutError):
        await display(message, "synthetic", menu("ru"), edit=True)
    assert chat.request.call_count == 1
    assert isinstance(chat.last, EditMessageText)

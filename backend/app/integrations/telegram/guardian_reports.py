"""Explicit recipient-authenticated demo reports. No owner capability is inferred."""

import secrets
import time
import uuid
from collections.abc import Awaitable, Callable

from aiogram import F, Router
from aiogram.dispatcher.event.bases import SkipHandler
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.base import utcnow
from app.integrations.errors import IntegrationError
from app.integrations.guardian_reports import ReportRequest, contact_identity, create_report
from app.integrations.models import GuardianReport, TrustedContact
from app.integrations.telegram.assistant_ui import language as preferred_language
from app.integrations.telegram.recipient_pages import page_number, report_page

COPY = {
    "ru": {
        "choose": (
            "Выберите своё действующее согласие. Это обращение доверенного "
            "контакта в демонстрационный SOC, не обращение в банк."
        ),
        "empty": (
            "Нет действующего подтверждённого согласия. Для этого демо-раздела"
            " нужна личная ссылка приглашения и отдельное согласие."
        ),
        "category": "Выберите категорию демо-обращения.",
        "impersonation": "Представились сотрудником банка",
        "safe_account": "«Безопасный счёт»",
        "remote_access": "Удалённый доступ",
        "other": "Другое",
        "describe": (
            "Опишите ситуацию: 10–500 символов. Не присылайте PIN, CVV, OTP, "
            "пароли, номера, ссылки, контакты или реквизиты."
        ),
        "invalid": (
            "Описание отклонено. Используйте 10–500 символов обычного текста "
            "без секретов, номеров, ссылок и контактов."
        ),
        "preview": (
            "Демонстрационный SOC получит этот текст на 7 дней. Это не "
            "официальный канал банка. Подтвердите отправку:"
        ),
        "submit": "Отправить в демо-SOC",
        "cancel": "Отмена",
        "back": "Главное меню",
        "received": "Создано демо-обращение. Банк его не получал и не рассматривал. Номер: ",
        "status": "Обновить состояние",
        "submitted": "Передано в демонстрационный SOC",
        "reviewed": "Отмечено оператором демо; не решение банка",
        "error": (
            "Запрос недоступен: проверьте согласие, срок и повторные действия. Вернитесь в меню."
        ),
        "none": "Действующих демо-обращений нет.",
        "contact": "Согласие ",
    },
    "kk": {
        "choose": (
            "Белсенді келісіміңізді таңдаңыз. Бұл сенімді адамның демо-SOC-қа "
            "хабарламасы, банкке өтініш емес."
        ),
        "empty": (
            "Белсенді расталған келісім жоқ. Демо-бөлімге жеке шақыру "
            "сілтемесі және бөлек келісім қажет."
        ),
        "category": "Демо-хабарлама санатын таңдаңыз.",
        "impersonation": "Банк қызметкері болып танысты",
        "safe_account": "«Қауіпсіз шот»",
        "remote_access": "Қашықтан қол жеткізу",
        "other": "Басқа",
        "describe": (
            "Жағдайды сипаттаңыз: 10–500 таңба. PIN, CVV, OTP, құпиясөз, "
            "нөмір, сілтеме, байланыс немесе банк деректемелерін жібермеңіз."
        ),
        "invalid": (
            "Сипаттама қабылданбады. Құпиясыз, нөмірсіз, сілтемесіз және "
            "байланыс деректерінсіз 10–500 таңба жазыңыз."
        ),
        "preview": (
            "Демо-SOC бұл мәтінді 7 күн сақтайды. Бұл банктің ресми арнасы емес. Жіберуді растаңыз:"
        ),
        "submit": "Демо-SOC-қа жіберу",
        "cancel": "Бас тарту",
        "back": "Басты мәзір",
        "received": "Демо-хабарлама жасалды. Банк оны алған немесе қараған жоқ. Нөмір: ",
        "status": "Күйді жаңарту",
        "submitted": "Демонстрациялық SOC-қа берілді",
        "reviewed": "Демо операторы белгіледі; банк шешімі емес",
        "error": (
            "Сұрау қолжетімсіз: келісімді, мерзімді және қайталанған "
            "әрекеттерді тексеріңіз. Мәзірге оралыңыз."
        ),
        "none": "Белсенді демо-хабарламалар жоқ.",
        "contact": "Келісім ",
    },
}


def keys(rows: list[tuple[str, str]]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=label, callback_data=data)] for label, data in rows
        ]
    )


def build_report_router(
    factory: async_sessionmaker[AsyncSession], admitted: Callable[[int], Awaitable[bool]]
) -> Router:
    router = Router(name="guardian-reports")

    @router.message(Command("report", "reports"))
    async def report_command(message: Message, state: FSMContext, command: CommandObject) -> None:
        if (
            message.chat.type != "private"
            or message.from_user is None
            or message.from_user.id != message.chat.id
            or not await admitted(message.chat.id)
        ):
            return
        await render_report(
            "begin" if command.command == "report" else "list", message, state, edit=False
        )

    @router.callback_query(F.data.startswith("r:"))
    async def report_action(query: CallbackQuery, state: FSMContext) -> None:
        message = query.message
        if (
            not isinstance(message, Message)
            or message.chat.type != "private"
            or query.from_user.id != message.chat.id
            or not await admitted(message.chat.id)
        ):
            return
        await query.answer()
        try:
            await render_report((query.data or "")[2:], message, state, edit=True)
        except TelegramBadRequest:
            # An unchanged/deleted message never justifies a fallback send.
            return

    async def render_report(
        action: str, message: Message, state: FSMContext, *, edit: bool
    ) -> None:
        data = await state.get_data()
        lang = preferred_language(data.get("language"))
        t = COPY[lang]
        reply = message.edit_text if edit else message.answer
        back = keys([(t["back"], "g:home")])
        try:
            async with factory() as session:
                if action == "list" or action.startswith("list:"):
                    page = page_number(action.split(":")[1]) if ":" in action else 0
                    await state.set_data({"language": lang})
                    text, markup = await report_page(session, message.chat.id, lang, page)
                    await reply(text, reply_markup=markup, parse_mode=None)
                    return
                if action == "begin":
                    contacts = list(
                        await session.scalars(
                            select(TrustedContact)
                            .where(
                                TrustedContact.telegram_chat_id == str(message.chat.id),
                                TrustedContact.state == "CONTACT_VERIFIED",
                                TrustedContact.contact_consented_at.is_not(None),
                            )
                            .order_by(TrustedContact.created_at, TrustedContact.id)
                            .limit(10)
                        )
                    )
                    await state.set_data({"language": lang})
                    if not contacts:
                        await reply(t["empty"], reply_markup=back, parse_mode=None)
                    else:
                        await reply(
                            t["choose"],
                            reply_markup=keys(
                                [
                                    (t["contact"] + str(i + 1), f"r:contact:{c.id}")
                                    for i, c in enumerate(contacts)
                                ]
                                + [(t["cancel"], "g:home")]
                            ),
                            parse_mode=None,
                        )
                    return
                if action.startswith("status:"):
                    await state.set_data({"language": lang})
                    row = await session.get(GuardianReport, uuid.UUID(action.split(":")[1]))
                    if row is None or row.contact_id is None or row.expires_at <= utcnow():
                        raise IntegrationError(404, "incident_not_found")
                    await contact_identity(session, row.contact_id, message.chat.id)
                    await reply(
                        str(row.id)
                        + " · "
                        + t["submitted" if row.state == "SUBMITTED" else "reviewed"],
                        reply_markup=keys(
                            [(t["status"], "r:status:" + str(row.id)), (t["back"], "g:home")]
                        ),
                        parse_mode=None,
                    )
                    return
                if action.startswith("contact:"):
                    contact = await contact_identity(
                        session, uuid.UUID(action.split(":")[1]), message.chat.id
                    )
                    report_key = str(uuid.uuid4())
                    await state.set_data(
                        {
                            "language": lang,
                            "report_contact": str(contact.id),
                            "report_key": report_key,
                            "report_expires": time.time() + 900,
                        }
                    )
                    await reply(
                        t["category"],
                        reply_markup=keys(
                            [
                                (t[c], "r:category:" + report_key[:8] + ":" + c)
                                for c in ("impersonation", "safe_account", "remote_access", "other")
                            ]
                            + [(t["cancel"], "g:home")]
                        ),
                        parse_mode=None,
                    )
                    return
                if time.time() >= data.get("report_expires", 0):
                    raise IntegrationError(409, "report_draft_expired")
                contact = await contact_identity(
                    session, uuid.UUID(data["report_contact"]), message.chat.id
                )
                if action.startswith("category:"):
                    parts = action.split(":")
                    if len(parts) != 3 or parts[1] != data["report_key"][:8]:
                        raise ValueError
                    category = parts[2]
                    if category not in {"impersonation", "safe_account", "remote_access", "other"}:
                        raise ValueError
                    # A category change invalidates any previous preview and confirmation.
                    await state.set_data(
                        {
                            k: data[k]
                            for k in ("language", "report_contact", "report_key", "report_expires")
                        }
                        | {"report_category": category, "report_waiting": True}
                    )
                    await reply(t["describe"], reply_markup=back, parse_mode=None)
                elif action.startswith("submit:"):
                    confirmation = data.get("report_confirm", "")
                    if (
                        not confirmation
                        or data.get("report_waiting") is not False
                        or not secrets.compare_digest(action.split(":", 1)[1], confirmation)
                    ):
                        raise ValueError
                    body = ReportRequest.model_validate(
                        {
                            "category": data["report_category"],
                            "description": data["report_description"],
                            "confirmed_demo_submission": True,
                        }
                    )
                    row = await create_report(
                        session,
                        contact.owner_id,
                        body,
                        uuid.UUID(data["report_key"]),
                        contact_id=contact.id,
                    )
                    await state.set_data({"language": lang})
                    await reply(
                        t["received"] + str(row.id),
                        reply_markup=keys(
                            [(t["status"], "r:status:" + str(row.id)), (t["back"], "g:home")]
                        ),
                        parse_mode=None,
                    )
                else:
                    raise ValueError
        except (IntegrationError, ValueError, KeyError):
            await reply(t["error"], reply_markup=back, parse_mode=None)

    @router.message(F.text, ~F.text.startswith("/"))
    async def description(message: Message, state: FSMContext) -> None:
        if (
            message.chat.type != "private"
            or message.from_user is None
            or message.from_user.id != message.chat.id
        ):
            return
        data = await state.get_data()
        if not data.get("report_waiting"):
            raise SkipHandler
        if not await admitted(message.chat.id):
            return
        t = COPY[preferred_language(data.get("language"))]
        try:
            if time.time() >= data.get("report_expires", 0):
                raise ValueError
            async with factory() as session:
                await contact_identity(session, uuid.UUID(data["report_contact"]), message.chat.id)
            body = ReportRequest.model_validate(
                {
                    "category": data["report_category"],
                    "description": message.text,
                    "confirmed_demo_submission": True,
                }
            )
        except (ValidationError, ValueError, KeyError, IntegrationError):
            await message.answer(t["invalid"], parse_mode=None)
            return
        confirmation = secrets.token_hex(8)
        await state.update_data(
            report_description=body.description, report_waiting=False, report_confirm=confirmation
        )
        await message.answer(
            t["preview"] + "\n\n" + body.description,
            parse_mode=None,
            reply_markup=keys([(t["submit"], "r:submit:" + confirmation), (t["cancel"], "g:home")]),
        )

    return router

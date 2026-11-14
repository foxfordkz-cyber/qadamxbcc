"""Explicit recipient-authenticated demo reports. No owner capability is inferred."""

import time
import uuid
from collections.abc import Awaitable, Callable

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.base import utcnow
from app.integrations.errors import IntegrationError
from app.integrations.guardian_reports import ReportRequest, contact_identity, create_report
from app.integrations.models import GuardianReport, TrustedContact

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
        data = await state.get_data()
        lang = data.get("language", "ru")
        t = COPY[lang]
        action = (query.data or "")[2:]
        back = keys([(t["back"], "g:home")])
        try:
            async with factory() as session:
                if action in {"begin", "list"}:
                    contacts = list(
                        await session.scalars(
                            select(TrustedContact)
                            .where(
                                TrustedContact.telegram_chat_id == str(message.chat.id),
                                TrustedContact.state == "CONTACT_VERIFIED",
                                TrustedContact.contact_consented_at.is_not(None),
                            )
                            .limit(10)
                        )
                    )
                    await state.set_data({"language": lang})
                    if not contacts:
                        await message.edit_text(t["empty"], reply_markup=back, parse_mode=None)
                    elif action == "begin":
                        await message.edit_text(
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
                    else:
                        rows = list(
                            await session.scalars(
                                select(GuardianReport)
                                .where(
                                    GuardianReport.contact_id.in_([c.id for c in contacts]),
                                    GuardianReport.expires_at > utcnow(),
                                )
                                .order_by(GuardianReport.created_at.desc())
                                .limit(10)
                            )
                        )
                        text = "\n".join(
                            str(r.id)
                            + " · "
                            + t["submitted" if r.state == "SUBMITTED" else "reviewed"]
                            for r in rows
                        )
                        await message.edit_text(
                            text or t["none"], reply_markup=back, parse_mode=None
                        )
                    return
                if action.startswith("status:"):
                    row = await session.get(GuardianReport, uuid.UUID(action.split(":")[1]))
                    if row is None or row.contact_id is None or row.expires_at <= utcnow():
                        raise IntegrationError(404, "incident_not_found")
                    await contact_identity(session, row.contact_id, message.chat.id)
                    await message.edit_text(
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
                    await state.set_data(
                        {
                            "language": lang,
                            "report_contact": str(contact.id),
                            "report_key": str(uuid.uuid4()),
                            "report_expires": time.time() + 900,
                        }
                    )
                    await message.edit_text(
                        t["category"],
                        reply_markup=keys(
                            [
                                (t[c], "r:category:" + c)
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
                    category = action.split(":")[1]
                    if category not in {"impersonation", "safe_account", "remote_access", "other"}:
                        raise ValueError
                    await state.update_data(report_category=category, report_waiting=True)
                    await message.edit_text(t["describe"], reply_markup=back, parse_mode=None)
                elif action == "submit":
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
                    await message.edit_text(
                        t["received"] + str(row.id),
                        reply_markup=keys(
                            [(t["status"], "r:status:" + str(row.id)), (t["back"], "g:home")]
                        ),
                        parse_mode=None,
                    )
        except (IntegrationError, ValueError, KeyError):
            await message.edit_text(t["error"], reply_markup=back, parse_mode=None)

    @router.message(F.text, ~F.text.startswith("/"))
    async def description(message: Message, state: FSMContext) -> None:
        if (
            message.chat.type != "private"
            or message.from_user is None
            or message.from_user.id != message.chat.id
            or not await admitted(message.chat.id)
        ):
            return
        data = await state.get_data()
        if not data.get("report_waiting"):
            return
        t = COPY[data.get("language", "ru")]
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
        await state.update_data(report_description=body.description, report_waiting=False)
        await message.answer(
            t["preview"] + "\n\n" + body.description,
            parse_mode=None,
            reply_markup=keys([(t["submit"], "r:submit"), (t["cancel"], "g:home")]),
        )

    return router

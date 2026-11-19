"""Recipient-only demo navigation. Never grants bank-owner capabilities."""

import secrets
import time
import uuid
from collections.abc import Awaitable, Callable

from aiogram import F, Router
from aiogram.dispatcher.event.bases import SkipHandler
from aiogram.filters import Command, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.integrations.errors import IntegrationError
from app.integrations.guardian_reports import contact_identity
from app.integrations.models import ContactNotification, TrustedContact
from app.integrations.telegram.assistant_ui import COPY as ASSISTANT
from app.integrations.telegram.assistant_ui import display
from app.integrations.telegram.assistant_ui import language as preferred_language
from app.integrations.telegram.guardian_reports import build_report_router
from app.integrations.telegram.recipient_pages import (
    dashboard,
    notification_detail,
    notification_page,
    page_number,
)
from app.integrations.telegram.schemas import ContactState
from app.integrations.telegram.templates import STATE_LABELS

TEXT = {
    "ru": {
        "welcome": (
            "🛡 Saq Bol Guardian\nДемонстрационный помощник Saq Bol. Не "
            "является официальным сервисом банка.\nНе присылайте PIN, CVV, OTP,"
            " пароли или банковские реквизиты."
        ),
        "security": "🛡 Моя безопасность",
        "alerts": "🔔 Уведомления",
        "contacts": "👥 Доверенные контакты",
        "scam": "🔎 Проверка мошенничества",
        "history": "📋 История событий",
        "language": "🌐 Сменить язык",
        "help": "❓ Помощь",
        "back": "← Главное меню",
        "yes": "Да",
        "no": "Нет",
        "finish": "Завершить",
        "empty": (
            "Доступных записей нет. Приглашение создаёт владелец в защищённом "
            "приложении. Привязка Telegram не даёт банковских полномочий."
        ),
        "help_text": (
            "Используйте личную ссылку приглашения и отдельно подтвердите "
            "согласие. Отзыв доступен через /contacts без ввода идентификатора."
            " Для проверки обращения самостоятельно откройте официальный "
            "банковский канал, которым вы уже пользуетесь. Бот не одобряет "
            "переводы и не блокирует счета."
        ),
        "survey": (
            "Учебная проверка, не банковское решение. Ответы не меняют статус "
            "перевода. Можно завершить в любой момент."
        ),
        "result": (
            "Обратите внимание на отмеченные признаки. Не действуйте под "
            "давлением; самостоятельно свяжитесь с банком через известный "
            "официальный канал. Даже отсутствие отмеченных признаков не "
            "доказывает безопасность."
        ),
        "draft": "Подготовить сообщение",
        "draft_text": (
            "Черновик для самостоятельного обращения: «Прошу помочь проверить "
            "подозрительное обращение. Я остановил взаимодействие и хочу "
            "связаться через официальный канал». Никуда не отправлено. Не "
            "добавляйте секреты."
        ),
        "stale": "Этот шаг устарел. Откройте опрос заново.",
        "scope": (
            "Демо-раздел получателя. Показаны только ваши согласия и "
            "адресованные вам уведомления; банковские данные владельца "
            "недоступны."
        ),
    },
    "kk": {
        "welcome": (
            "🛡 Saq Bol Guardian\nSaq Bol демонстрациялық көмекшісі. "
            "Банктің ресми қызметі емес.\nPIN, CVV, OTP, құпиясөздер немесе "
            "банк деректемелерін жібермеңіз."
        ),
        "security": "🛡 Қауіпсіздігім",
        "alerts": "🔔 Ескертулер",
        "contacts": "👥 Сенімді адамдар",
        "scam": "🔎 Алаяқтықты тексеру",
        "history": "📋 Оқиғалар тарихы",
        "language": "🌐 Тілді ауыстыру",
        "help": "❓ Көмек",
        "back": "← Басты мәзір",
        "yes": "Иә",
        "no": "Жоқ",
        "finish": "Аяқтау",
        "empty": (
            "Қолжетімді жазбалар жоқ. Шақыруды иесі қорғалған қолданбада "
            "жасайды. Telegram байланысы банк өкілеттігін бермейді."
        ),
        "help_text": (
            "Жеке шақыру сілтемесін ашып, келісімді бөлек растаңыз. Келісімді "
            "/contacts арқылы идентификаторсыз қайтаруға болады. Өзіңіз пайдаланатын"
            " ресми банк арнасын өз бетіңізше ашыңыз. Бот аударымдарды "
            "мақұлдамайды және шоттарды бұғаттамайды."
        ),
        "survey": (
            "Оқу тексеруі, банктің шешімі емес. Жауаптар аударым күйін "
            "өзгертпейді. Кез келген уақытта аяқтауға болады."
        ),
        "result": (
            "Белгіленген белгілерге назар аударыңыз. Қысыммен әрекет етпеңіз; "
            "банкке белгілі ресми арна арқылы өзіңіз хабарласыңыз. Белгілердің"
            " болмауы қауіпсіздікті дәлелдемейді."
        ),
        "draft": "Хабарлама дайындау",
        "draft_text": (
            "Өз бетіңізше жүгінуге арналған жоба: «Күмәнді хабарласуды "
            "тексеруге көмектесіңіз. Байланысты тоқтаттым, ресми арна арқылы "
            "хабарласқым келеді». Ешқайда жіберілген жоқ. Құпияларды қоспаңыз."
        ),
        "stale": "Бұл қадам ескірген. Сауалнаманы қайта ашыңыз.",
        "scope": (
            "Алушының демо-бөлімі. Тек сіздің келісімдеріңіз және сізге "
            "арналған хабарламалар көрсетіледі; иесінің банк деректері "
            "қолжетімсіз."
        ),
    },
}
# Exact existing CoolingQuestionnaire fields; no score or resolve-cooling call.
QUESTIONS: list[tuple[str, str, str, bool]] = [
    (
        "caller_claims_bank_or_police",
        "Звонящий представился сотрудником банка или полиции?",
        "Қоңырау шалушы банк немесе полиция қызметкері болып танысты ма?",
        True,
    ),
    (
        "asked_to_move_to_safe_account",
        "Просили перевести деньги на «безопасный счёт»?",
        "Ақшаны «қауіпсіз шотқа» аударуды сұрады ма?",
        True,
    ),
    (
        "asked_to_keep_secret_or_install_app",
        "Просили сохранить разговор в секрете или установить приложение?",
        "Әңгімені құпия ұстауды немесе қолданба орнатуды сұрады ма?",
        True,
    ),
    (
        "initiated_by_customer",
        "Вы сами решили сделать перевод?",
        "Аударым жасауды өзіңіз шештіңіз бе?",
        False,
    ),
    (
        "knows_recipient_personally",
        "Вы лично знаете получателя?",
        "Алушыны жеке танисыз ба?",
        False,
    ),
]


def keyboard(rows: list[tuple[str, str]]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=label, callback_data="g:" + action)]
            for label, action in rows
        ]
    )


def menu(language: str) -> InlineKeyboardMarkup:
    result = keyboard(
        [
            (TEXT[language][k], k)
            for k in ("security", "alerts", "contacts", "scam", "history", "language", "help")
        ]
    )
    for key, action in (
        ("report", "r:begin"),
        ("reports", "r:list"),
        ("safety", "g:safety"),
        ("privacy", "g:privacy"),
    ):
        result.inline_keyboard.insert(
            -2, [InlineKeyboardButton(text=ASSISTANT[language][key], callback_data=action)]
        )
    return result


async def recipient_view(
    factory: async_sessionmaker[AsyncSession], chat_id: int, page: str, language: str
) -> str:
    t = TEXT[language]
    async with factory() as session:
        contacts = list(
            await session.scalars(
                select(TrustedContact)
                .where(
                    TrustedContact.telegram_chat_id == str(chat_id),
                    TrustedContact.state == ContactState.VERIFIED,
                    TrustedContact.contact_consented_at.is_not(None),
                )
                .order_by(TrustedContact.created_at.desc())
                .limit(10)
            )
        )
        if not contacts:
            return t["scope"] + "\n\n" + t["empty"]
        if page in {"security", "contacts"}:
            return (
                t["scope"]
                + "\n"
                + ("Активных согласий: " if language == "ru" else "Белсенді келісімдер: ")
                + str(len(contacts))
            )
        rows = list(
            await session.scalars(
                select(ContactNotification)
                .where(ContactNotification.contact_id.in_([c.id for c in contacts]))
                .order_by(ContactNotification.created_at.desc())
                .limit(10)
            )
        )
        return (
            t["scope"]
            + "\n\n"
            + (
                "\n".join(
                    f"{r.created_at:%Y-%m-%d %H:%M} UTC · "
                    + STATE_LABELS.get(r.state, ("Состояние недоступно", "Күй қолжетімсіз"))[
                        0 if language == "ru" else 1
                    ]
                    for r in rows
                )
                or t["empty"]
            )
        )


def build_router(
    factory: async_sessionmaker[AsyncSession], admitted: Callable[[int], Awaitable[bool]]
) -> Router:
    router = Router(name="guardian")
    router.include_router(build_report_router(factory, admitted))

    commands = {
        "start": "home",
        "menu": "home",
        "help": "help",
        "status": "security",
        "notifications": "alerts",
        "contacts": "contacts",
        "revoke": "contacts",
        "check": "scam",
        "language": "language",
        "privacy": "privacy",
        "safety": "safety",
        "cancel": "cancel",
    }

    @router.message(Command(*commands))
    async def welcome(message: Message, state: FSMContext, command: CommandObject) -> None:
        if command.command in {"start", "revoke"} and command.args:
            raise SkipHandler
        if (
            message.chat.type != "private"
            or message.from_user is None
            or message.from_user.id != message.chat.id
            or not await admitted(message.chat.id)
        ):
            return
        data = await state.get_data()
        if "language" not in data and command.command == "start":
            await message.answer(
                TEXT["ru"]["welcome"] + "\n\n" + TEXT["kk"]["welcome"],
                reply_markup=keyboard([("Русский", "ru"), ("Қазақша", "kk")]),
                parse_mode=None,
            )
            return
        await render(commands[command.command], message, state, edit=False)

    @router.callback_query(F.data.startswith("g:"))
    async def navigate(query: CallbackQuery, state: FSMContext) -> None:
        message = query.message
        if (
            not isinstance(message, Message)
            or message.chat.type != "private"
            or query.from_user.id != message.chat.id
            or not await admitted(message.chat.id)
        ):
            return
        await query.answer()
        await render((query.data or "")[2:], message, state, edit=True)

    async def render(action: str, message: Message, state: FSMContext, *, edit: bool) -> None:
        data = await state.get_data()
        language = preferred_language(data.get("language"))
        if not action.startswith("a:"):
            # Leaving any draft clears it, including its confirmation nonce.
            data = {"language": language}
            await state.set_data(data)
        if action in {"ru", "kk"}:
            language = action
            await state.set_data({"language": language})
            action = "home"
        t = TEXT[language]
        text, buttons = t["welcome"], menu(language)
        if action == "language":
            buttons = keyboard([("Русский", "ru"), ("Қазақша", "kk"), (t["back"], "home")])
        elif action == "security":
            text = await dashboard(factory, message.chat.id, language)
            buttons = keyboard(
                [(t["alerts"], "alerts"), (t["contacts"], "contacts"), (t["back"], "home")]
            )
        elif action in {"alerts", "history"} or action.startswith("notifications:"):
            try:
                page = page_number(action.split(":")[1]) if ":" in action else 0
                text, buttons = await notification_page(factory, message.chat.id, language, page)
            except ValueError:
                text = ASSISTANT[language]["unavailable"]
                buttons = keyboard([(t["back"], "home")])
        elif action.startswith("notification:"):
            text, buttons = await notification_detail(
                factory, message.chat.id, language, action.split(":", 1)[1]
            )
        elif action == "contacts":
            text = await recipient_view(factory, message.chat.id, action, language)
            buttons = keyboard([(t["back"], "home")])
            async with factory() as session:
                contacts = list(
                    await session.scalars(
                        select(TrustedContact)
                        .where(
                            TrustedContact.telegram_chat_id == str(message.chat.id),
                            TrustedContact.state == ContactState.VERIFIED,
                            TrustedContact.contact_consented_at.is_not(None),
                        )
                        .order_by(TrustedContact.created_at.desc(), TrustedContact.id.desc())
                        .limit(10)
                    )
                )
            for i, contact in enumerate(contacts):
                label = "Отозвать согласие " if language == "ru" else "Келісімді қайтару "
                buttons.inline_keyboard.insert(
                    i,
                    [
                        InlineKeyboardButton(
                            text=label + str(i + 1), callback_data="g:revoke:" + str(contact.id)
                        )
                    ],
                )
        elif action.startswith("revoke:"):
            try:
                async with factory() as session:
                    contact = await contact_identity(
                        session, uuid.UUID(action.split(":")[1]), message.chat.id
                    )
            except (ValueError, IntegrationError):
                await message.edit_text(
                    t["stale"], reply_markup=keyboard([(t["back"], "home")]), parse_mode=None
                )
                return
            text = (
                "Отозвать согласие на уведомления?"
                if language == "ru"
                else "Хабарламаларға келісімді қайтару керек пе?"
            )
            buttons = InlineKeyboardMarkup(
                inline_keyboard=[
                    [
                        InlineKeyboardButton(
                            text=t["yes"], callback_data="revoke:" + str(contact.id)
                        )
                    ],
                    [InlineKeyboardButton(text=t["no"], callback_data="g:contacts")],
                ]
            )
        elif action == "help":
            text, buttons = t["help_text"], keyboard([(t["back"], "home")])
        elif action in {"privacy", "safety"}:
            text = ASSISTANT[language][action + "_text"]
            buttons = keyboard(
                [(t["contacts"], "contacts"), (t["scam"], "scam"), (t["back"], "home")]
            )
        elif action == "cancel":
            text, buttons = ASSISTANT[language]["cancelled"], menu(language)
        elif action == "scam" or action.startswith("a:"):
            if action == "scam":
                data = {
                    "language": language,
                    "nonce": secrets.token_hex(4),
                    "answers": [],
                    "expires": time.time() + 900,
                }
            else:
                parts = action.split(":")
                answers = data.get("answers", [])
                if (
                    len(parts) != 4
                    or parts[1] != data.get("nonce")
                    or parts[2] != str(len(answers))
                    or parts[3] not in {"0", "1"}
                    or time.time() >= data.get("expires", 0)
                    or len(answers) >= 5
                ):
                    await message.edit_text(
                        t["stale"], reply_markup=keyboard([(t["back"], "home")]), parse_mode=None
                    )
                    return
                data["answers"] = [*answers, parts[3] == "1"]
            await state.set_data(data)
            index = len(data["answers"])
            if index < len(QUESTIONS):
                text = (
                    t["survey"]
                    + f"\n\n{index + 1}/5 · "
                    + (QUESTIONS[index][1] if language == "ru" else QUESTIONS[index][2])
                )
                prefix = f"a:{data['nonce']}:{index}:"
                buttons = keyboard(
                    [(t["yes"], prefix + "1"), (t["no"], prefix + "0"), (t["finish"], "home")]
                )
            else:
                flags = [
                    (q[1] if language == "ru" else q[2]) + " — " + t["yes" if a else "no"]
                    for q, a in zip(QUESTIONS, data["answers"], strict=True)
                    if a == q[3]
                ]
                text = t["result"] + "\n\n" + "\n".join(flags)
                buttons = keyboard([(t["draft"], "draft"), (t["finish"], "home")])
        elif action == "draft":
            text, buttons = t["draft_text"], keyboard([(t["finish"], "home")])
            buttons.inline_keyboard.insert(
                0,
                [
                    InlineKeyboardButton(
                        text="Демо-обращение в SOC"
                        if language == "ru"
                        else "SOC-қа демо-хабарлама",
                        callback_data="r:begin",
                    )
                ],
            )
        else:
            await state.set_data({"language": language})
        await display(message, text, buttons, edit=edit)

    fallback = Router(name="guardian-fallback")

    @fallback.message()
    async def unknown(message: Message, state: FSMContext) -> None:
        if (
            message.chat.type != "private"
            or message.from_user is None
            or message.from_user.id != message.chat.id
            or not await admitted(message.chat.id)
        ):
            return
        lang = preferred_language((await state.get_data()).get("language"))
        # Do not echo, persist, forward or download unsolicited text/media.
        await message.answer(ASSISTANT[lang]["fallback"], reply_markup=menu(lang), parse_mode=None)

    router.include_router(fallback)

    return router

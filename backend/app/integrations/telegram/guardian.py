"""Recipient-only demo navigation. Never grants bank-owner capabilities."""

import secrets
import time
from collections.abc import Awaitable, Callable

from aiogram import F, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.integrations.models import ContactNotification, TrustedContact
from app.integrations.telegram.schemas import ContactState
from app.integrations.telegram.templates import STATE_LABELS

TEXT = {
    "ru": {
        "welcome": (
            "🛡 BCC Shield Guardian\nДемонстрационный помощник BCC Shield. Не "
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
            "согласие. Отзыв: /revoke <идентификатор контакта из приглашения>."
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
            "🛡 BCC Shield Guardian\nBCC Shield демонстрациялық көмекшісі. "
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
            "Жеке шақыру сілтемесін ашып, келісімді бөлек растаңыз. Қайтару: "
            "/revoke <шақырудағы байланыс идентификаторы>. Өзіңіз пайдаланатын"
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
    return keyboard(
        [
            (TEXT[language][k], k)
            for k in ("security", "alerts", "contacts", "scam", "history", "language", "help")
        ]
    )


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

    @router.message(Command("start", "help", "menu"), ~F.text.contains(" "))
    async def welcome(message: Message, state: FSMContext) -> None:
        if (
            message.chat.type != "private"
            or message.from_user is None
            or message.from_user.id != message.chat.id
            or not await admitted(message.chat.id)
        ):
            return
        data = await state.get_data()
        language = data.get("language", "ru")
        await state.set_data({"language": language})
        await message.answer(
            TEXT[language]["welcome"], reply_markup=menu(language), parse_mode=None
        )

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
        data = await state.get_data()
        language = data.get("language", "ru")
        action = (query.data or "")[2:]
        if action in {"ru", "kk"}:
            language = action
            await state.set_data({"language": language})
            action = "home"
        t = TEXT[language]
        text, buttons = t["welcome"], menu(language)
        if action == "language":
            buttons = keyboard([("Русский", "ru"), ("Қазақша", "kk"), (t["back"], "home")])
        elif action in {"security", "contacts", "alerts", "history"}:
            text = await recipient_view(factory, message.chat.id, action, language)
            buttons = keyboard([(t["back"], "home")])
        elif action == "help":
            text, buttons = t["help_text"], keyboard([(t["back"], "home")])
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
        else:
            await state.set_data({"language": language})
        # Editing is never retried as a new send on an ambiguous provider result.
        try:
            await message.edit_text(text, reply_markup=buttons, parse_mode=None)
        except TelegramBadRequest:
            # Deleted/unchanged messages do not warrant a new notification.
            return

    return router

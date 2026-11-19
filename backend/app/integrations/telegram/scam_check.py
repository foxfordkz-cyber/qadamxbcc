"""Explicit, single-message offline scan. Raw input never enters FSM or a database."""

import time
from collections.abc import Awaitable, Callable

from aiogram import F, Router
from aiogram.dispatcher.event.bases import SkipHandler
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from pydantic import ValidationError

from app.integrations.scam_check import Language, ScamCheckRequest, analyze
from app.integrations.telegram.assistant_ui import display

COPY = {
    "ru": {
        "title": "📝 Проверить текст",
        "prompt": (
            "Пришлите одно синтетическое описание ситуации (до 2000 символов). "
            "Не присылайте коды, документы, имена или реквизиты. Проверка выполняется "
            "локально; текст не сохраняется в базе/FSM и не передаётся внешнему AI. "
            "Telegram отдельно хранит переписку. Мы не открываем ссылки. "
            "Ожидание — 15 минут; /cancel отменяет проверку."
        ),
        "invalid": "Нужно текстовое описание от 1 до 2000 символов. Начните заново через /scan.",
        "expired": "Время ожидания истекло. Для новой проверки откройте /scan.",
        "signals_detected": "Обнаружены признаки, которые стоит проверить:",
        "no_known_signals": "Известные этим правилам признаки не обнаружены.",
        "insufficient_context": "Недостаточно однозначного контекста для вывода.",
        "back": "← Главное меню",
    },
    "kk": {
        "title": "📝 Мәтінді тексеру",
        "prompt": (
            "Жағдайдың бір синтетикалық сипаттамасын жіберіңіз (2000 таңбаға дейін). "
            "Кодтарды, құжаттарды, есімдерді немесе деректемелерді жібермеңіз. Тексеру "
            "жергілікті орындалады; мәтін базаға/FSM-ге сақталмайды және сыртқы AI-ға "
            "берілмейді. Telegram хат алмасуды бөлек сақтайды. Сілтемелерді ашпаймыз. "
            "Күту уақыты — 15 минут; /cancel тексеруді тоқтатады."
        ),
        "invalid": "1–2000 таңбадан тұратын мәтін керек. /scan арқылы қайта бастаңыз.",
        "expired": "Күту уақыты аяқталды. Жаңа тексеруді /scan арқылы ашыңыз.",
        "signals_detected": "Тексеруге назар аударатын белгілер табылды:",
        "no_known_signals": "Осы ережелерге белгілі белгілер табылмады.",
        "insufficient_context": "Қорытынды жасау үшін бірмәнді контекст жеткіліксіз.",
        "back": "← Басты мәзір",
    },
}


def back(lang: Language) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=COPY[lang]["back"], callback_data="g:home")]]
    )


def build_scan_router(admitted: Callable[[int], Awaitable[bool]]) -> Router:
    router = Router(name="private-scam-check")

    async def permitted(message: Message, actor: int) -> bool:
        return (
            message.chat.type == "private"
            and actor == message.chat.id
            and await admitted(message.chat.id)
        )

    async def begin(message: Message, state: FSMContext, *, edit: bool) -> None:
        data = await state.get_data()
        lang: Language = "kk" if data.get("language") == "kk" else "ru"
        await state.set_data({"language": lang, "scan_expires": time.time() + 900})
        await display(message, COPY[lang]["prompt"], back(lang), edit=edit)

    @router.message(Command("scan"))
    async def command(message: Message, state: FSMContext) -> None:
        if message.from_user and await permitted(message, message.from_user.id):
            await begin(message, state, edit=False)

    @router.callback_query(F.data == "s:begin")
    async def start(query: CallbackQuery, state: FSMContext) -> None:
        if isinstance(query.message, Message) and await permitted(
            query.message, query.from_user.id
        ):
            await query.answer()
            await begin(query.message, state, edit=True)

    @router.message(F.text, ~F.text.startswith("/"))
    async def text(message: Message, state: FSMContext) -> None:
        data = await state.get_data()
        if "scan_expires" not in data:
            raise SkipHandler
        if not message.from_user or not await permitted(message, message.from_user.id):
            return
        lang: Language = "kk" if data.get("language") == "kk" else "ru"
        # Clear the waiting marker before analysis/send; retries cannot re-use the flow.
        await state.set_data({"language": lang})
        if time.time() >= data["scan_expires"]:
            await message.answer(COPY[lang]["expired"], reply_markup=back(lang), parse_mode=None)
            return
        try:
            result = analyze(ScamCheckRequest(text=message.text or "", language=lang))
        except ValidationError:
            await message.answer(COPY[lang]["invalid"], reply_markup=back(lang), parse_mode=None)
            return
        response = "\n\n".join(
            [
                COPY[lang][result.status],
                "\n".join("• " + signal.explanation for signal in result.signals),
                result.guidance,
                result.limitation,
            ]
        )
        await message.answer(response, reply_markup=back(lang), parse_mode=None)

    return router

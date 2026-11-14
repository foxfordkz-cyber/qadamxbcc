"""Safe UI descriptions derived only from normalized enums, never provider text."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from app.integrations.nbk_mock.schemas import GatewayResult

STATUS_TEXT = {
    "CLEAR": (
        "В тестовых данных признаки риска отсутствуют.",
        "Тест деректерінде тәуекел белгілері жоқ.",
    ),
    "INDICATORS": (
        "В тестовых данных найдены синтетические признаки риска.",
        "Тест деректерінде синтетикалық тәуекел белгілері табылды.",
    ),
    "UNKNOWN": (
        "Достоверного результата тестовой проверки нет.",
        "Тест тексерісінің сенімді нәтижесі жоқ.",
    ),
    "UNAVAILABLE": (
        "Тестовый источник временно недоступен.",
        "Тест дереккөзі уақытша қолжетімсіз.",
    ),
}
MARKER_TEXT = {
    "SYNTHETIC_REVIEW": (
        "Синтетический признак дополнительной проверки.",
        "Қосымша тексерудің синтетикалық белгісі.",
    ),
    "SYNTHETIC_NETWORK_SIGNAL": (
        "Синтетический сигнал подозрительной сети.",
        "Күдікті желінің синтетикалық белгісі.",
    ),
}
ERROR_TEXT = {
    "UNKNOWN_IDENTIFIER": ("Тестовый идентификатор неизвестен.", "Тест идентификаторы белгісіз."),
    "INTERNAL_SERVICE_ERROR": ("Ошибка тестового сервиса.", "Тест сервисінің қатесі."),
    "GATEWAY_UNAVAILABLE": ("Источник не ответил.", "Дереккөз жауап бермеді."),
    "TIMEOUT": ("Время ожидания истекло.", "Күту уақыты аяқталды."),
    "MALFORMED_RESPONSE": ("Некорректный ответ источника.", "Дереккөз жауабының пішімі қате."),
    "EXPIRED_RESULT": ("Срок действия результата истёк.", "Нәтиженің жарамдылық мерзімі аяқталды."),
    "UNVERIFIED_RESPONSE": ("Ответ не прошёл проверку.", "Жауап тексеруден өтпеді."),
    "INCOMPLETE_CHECK": ("Предыдущая проверка не завершена.", "Алдыңғы тексеріс аяқталмаған."),
}
DISCLAIMER = (
    "Демонстрация MOCK. Сведения не разрешают и не блокируют операции.",
    "MOCK көрсетілімі. Бұл мәліметтер операцияны мақұлдамайды және бұғаттамайды.",
)


def describe_result(result: GatewayResult, language: Literal["ru", "kk"]) -> str:
    index = 0 if language == "ru" else 1
    parts = [STATUS_TEXT[result.status][index]]
    parts.extend(MARKER_TEXT[marker][index] for marker in result.markers)
    if result.error_code:
        parts.append(ERROR_TEXT[result.error_code][index])
    return " ".join([*parts, DISCLAIMER[index]])

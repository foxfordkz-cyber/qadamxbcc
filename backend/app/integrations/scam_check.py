"""Bounded, offline educational analysis. No I/O, persistence or financial authority."""

import re
import unicodedata
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Language = Literal["ru", "kk"]
SignalCode = Literal[
    "safe_account", "credentials", "remote_access", "secrecy", "impersonation", "advance_fee"
]
RULESET_VERSION = "scam-rules-1.0.0"
PRIVACY_VERSION = "local-mask-1.0.0"
MAX_TEXT = 2000


class ScamCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    text: str = Field(min_length=1, max_length=MAX_TEXT, repr=False)
    language: Language = "ru"

    @field_validator("text")
    @classmethod
    def meaningful(cls, value: str) -> str:
        if not normalize(value).strip():
            raise ValueError("text_required")
        return value


class ScamSignal(BaseModel):
    code: SignalCode
    explanation: str


class PrivacySummary(BaseModel):
    version: str = PRIVACY_VERSION
    processing: Literal["local_rules_only"] = "local_rules_only"
    stored: Literal[False] = False
    external_ai_used: Literal[False] = False
    masked_categories: list[str]
    masked_spans: int = Field(ge=0)


class ScamCheckResult(BaseModel):
    ruleset_version: str = RULESET_VERSION
    language: Language
    advisory_only: Literal[True] = True
    status: Literal["signals_detected", "no_known_signals", "insufficient_context"]
    signals: list[ScamSignal]
    guidance: str
    limitation: str
    privacy: PrivacySummary


EXPLANATIONS: dict[SignalCode, tuple[str, str]] = {
    "safe_account": (
        "Просьба перевести деньги на так называемый безопасный счёт.",
        "Ақшаны «қауіпсіз шотқа» аудару туралы өтініш.",
    ),
    "credentials": (
        "Просьба передать код подтверждения, пароль или данные доступа.",
        "Растау кодын, құпиясөзді немесе кіру деректерін беру туралы өтініш.",
    ),
    "remote_access": (
        "Просьба установить средство удалённого доступа или включить показ экрана.",
        "Қашықтан кіру құралын орнату немесе экранды көрсету туралы өтініш.",
    ),
    "secrecy": (
        "Требование скрыть разговор или денежные действия от других людей.",
        "Әңгімені немесе ақшаға қатысты әрекетті басқалардан жасыру талабы.",
    ),
    "impersonation": (
        "Ссылка на банк или полицию вместе с просьбой выполнить чувствительное действие.",
        "Банк не полиция атын атап, құпия деректерге не ақшаға қатысты әрекетті сұрау.",
    ),
    "advance_fee": (
        "Просьба внести предварительный платёж для получения приза, работы или кредита.",
        "Жүлде, жұмыс немесе несие алу үшін алдын ала төлем жасау туралы өтініш.",
    ),
}
GUIDANCE = (
    "Остановитесь и самостоятельно проверьте обращение через известный официальный канал. "
    "Не передавайте коды и не устанавливайте приложения по указанию незнакомца.",
    "Тоқтап, өтінішті өзіңіз білетін ресми арна арқылы тексеріңіз. Кодтарды бермеңіз және "
    "бейтаныс адамның нұсқауымен қолданба орнатпаңыз.",
)
LIMITATION = (
    "Это учебные правила, не банковское решение и не вероятность мошенничества. "
    "Отсутствие признаков не доказывает безопасность. Возможны пропуски, ложные срабатывания "
    "и ошибки понимания отрицаний; ссылки и отправитель не проверялись.",
    "Бұл оқу ережелері, банк шешімі немесе алаяқтық ықтималдығы емес. Белгілердің болмауы "
    "қауіпсіздікті дәлелдемейді. Белгілерді өткізіп алу, жалған белгі және терістеуді қате "
    "түсіну мүмкін; сілтемелер мен жіберуші тексерілмеді.",
)

# A limited set of visual Latin substitutions only inside Cyrillic words; not transliteration.
LOOKALIKES = str.maketrans("aceopxykmt", "асеорхукмт")


def normalize(text: str) -> str:
    value = "".join(
        c for c in unicodedata.normalize("NFKC", text).casefold() if unicodedata.category(c) != "Cf"
    ).replace("ё", "е")
    return re.sub(
        r"[a-z\u0400-\u052f]+",
        lambda m: m[0].translate(LOOKALIKES) if re.search(r"[\u0400-\u052f]", m[0]) else m[0],
        value,
    )


MASKS = (
    ("url", re.compile(r"(?:https?://|www\.)[^\s<>]+", re.I)),
    ("email", re.compile(r"[\w.+-]+@[\w.-]+\.[\w-]+", re.I)),
    ("iban", re.compile(r"\b[a-z]{2}\d{2}(?:[ -]?[a-z0-9]){10,30}\b", re.I)),
    (
        "secret",
        re.compile(
            r"\b(bearer\s+|(?:token|api[_ -]?key|password|пароль|құпиясөз)\s*[:=]\s*)"
            r"[^\s,;]+",
            re.I,
        ),
    ),
    ("number", re.compile(r"(?<!\w)\+?\d(?:[ ()-]{0,3}\d){3,}(?!\w)")),
)


def mask(text: str) -> tuple[str, PrivacySummary]:
    """Best-effort working-copy masking, NOT anonymization or a gateway for external AI."""
    value = normalize(text)
    categories = []
    total = 0
    for name, pattern in MASKS:
        replacement = r"\1 [masked] " if name == "secret" else " [masked] "
        value, count = pattern.subn(replacement, value)
        if count:
            categories.append(name)
            total += count
    return value, PrivacySummary(masked_categories=categories, masked_spans=total)


# Bounded clauses avoid combining an unrelated action from a distant paragraph.
ACTION = (
    r"перев[ео]д|перевести|отправ|сообщ|назов|назват|введ|оплат|внес|аудар|жібер|айтың|беріңіз|төле"
)
MONEY = r"деньг|счет|счёт|код|парол|ақша|шот|құпиясөз|otp|cvv|pin"
RULES: dict[SignalCode, tuple[str, str]] = {
    "safe_account": (r"безопасн\w*\s+счет|резервн\w*\s+счет|қауіпсіз\s+шот", ACTION),
    "credentials": (r"смс|sms|otp|cvv|pin|код\w*\s+подтвержд|парол|растау\s+код|құпиясөз", ACTION),
    "remote_access": (
        r"anydesk|teamviewer|удаленн\w*\s+доступ|қашықтан|экран",
        r"установ|скача|включ|орнат|қосыңыз",
    ),
    "secrecy": (
        r"никому\s+не\s+говор|сохран\w*\s+.{0,30}секрет|ешкімге\s+айтпа|құпия\s+ұста",
        r"разговор|перевод|деньг|банк|ақша|аудар|әңгіме",
    ),
    "impersonation": (
        r"сотрудник\w*\s+банка|служб\w*\s+безопасност|полиц|банк\s+қызметкер",
        ACTION + r"|установ|орнат",
    ),
    "advance_fee": (
        r"приз|выигрыш|ваканси|работ\w*\s+.{0,20}(?:получ|доступ)|кредит|жүлде|ұтыс|несие|жұмыс",
        r"предоплат|взнос|комисси|алдын\s+ала\s+төлем",
    ),
}
COMPILED = {code: (re.compile(a), re.compile(b)) for code, (a, b) in RULES.items()}
NEGATED = re.compile(
    r"\b(?:не|нельзя|никогда\s+не)\s+(?:переводите|переводи|сообщайте|сообщай|называйте|"
    r"передавайте|отправляйте|устанавливайте|платите)\b|"
    r"аудармаңыз|бермеңіз|жібермеңіз|орнатпаңыз|төлемеңіз"
)


def analyze(body: ScamCheckRequest) -> ScamCheckResult:
    value, privacy = mask(body.text)
    # A warning must not suppress a subsequent demand after a contrastive conjunction.
    clauses = re.split(r"[.!?;\n]+|\b(?:но|бірақ)\b|,\s*а\s+", value)
    found: set[SignalCode] = set()
    ambiguous = False
    for clause in clauses:
        if len(clause.strip()) < 8:
            continue
        for code, (subject, action) in COMPILED.items():
            if subject.search(clause) and action.search(clause):
                if NEGATED.search(clause):
                    ambiguous = True
                elif code != "impersonation" or re.search(MONEY + r"|установ|орнат", clause):
                    found.add(code)
    index = body.language == "kk"
    status: Literal["signals_detected", "no_known_signals", "insufficient_context"] = (
        "signals_detected"
        if found
        else "insufficient_context"
        if ambiguous or len(re.sub(r"\W", "", value)) < 12
        else "no_known_signals"
    )
    return ScamCheckResult(
        language=body.language,
        status=status,
        signals=[
            ScamSignal(code=c, explanation=EXPLANATIONS[c][index]) for c in RULES if c in found
        ],
        guidance=GUIDANCE[index],
        limitation=LIMITATION[index],
        privacy=privacy,
    )

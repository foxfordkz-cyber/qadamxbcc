import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.integrations.guardian_reports import Category, ReportRequest

State = Literal["NEW", "IN_REVIEW", "NEEDS_INFORMATION", "ESCALATED", "RESOLVED", "CLOSED"]
Staff = Literal["demo_analyst_a", "demo_analyst_b"]
Question = Literal["caller_request", "remote_access", "secrecy_pressure"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OpenCase(Strict):
    report_id: uuid.UUID


class Versioned(Strict):
    expected_version: int = Field(ge=1)


class Transition(Versioned):
    action: Literal["transition"]
    state: State
    reason: Literal[
        "review_started",
        "needs_followup",
        "review_complete",
        "duplicate",
        "reopened",
        "confirmed_fraud",
        "legitimate_transfer",
        "insufficient_evidence",
    ]


class Assign(Versioned):
    action: Literal["assign"]
    assignee: Staff | None


class Categorize(Versioned):
    action: Literal["categorize"]
    category: Category


class SafeText(Strict):
    body: str = Field(min_length=10, max_length=500)

    @field_validator("body")
    @classmethod
    def minimize(cls, value: str) -> str:
        return ReportRequest.safe_description(value)


class Note(SafeText, Versioned):
    action: Literal["note"]


class AskInformation(Versioned):
    action: Literal["request_information"]
    question: Question


class AnswerInformation(SafeText):
    confirmed_demo_submission: Literal[True]


Action = Annotated[
    Transition | Assign | Categorize | Note | AskInformation, Field(discriminator="action")
]


class CaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    report_id: uuid.UUID
    source: Literal["owner_demo", "trusted_contact", "guardian_timeout", "guardian_signal"]
    category: Category
    state: State
    assignee: Staff | None
    version: int
    created_at: datetime
    status_since: datetime
    expires_at: datetime
    demonstration_only: Literal[True] = True


class CasePage(BaseModel):
    items: list[CaseOut]
    next_cursor: str | None


class EventOut(BaseModel):
    id: uuid.UUID
    actor_id: uuid.UUID
    version: int
    code: str
    actor_role: Literal["soc", "owner", "system"]
    timestamp: datetime
    state: State
    category: Category
    assignee: Staff | None
    reason: str | None
    description_ru: str
    description_kk: str


class EventPage(BaseModel):
    items: list[EventOut]
    next_after_version: int | None


class ContentOut(BaseModel):
    event_id: uuid.UUID
    body: str
    expires_at: datetime


class ContentPage(BaseModel):
    items: list[ContentOut]
    next_after_version: int | None


class InformationOut(BaseModel):
    id: uuid.UUID
    question: Question
    description_ru: str
    description_kk: str
    created_at: datetime
    answered: bool


class AnswerReceipt(BaseModel):
    request_id: uuid.UUID
    received: Literal[True] = True


OUTCOME_REASONS = frozenset({"confirmed_fraud", "legitimate_transfer", "insufficient_evidence"})


class PolicyResult(BaseModel):
    threshold: int | None
    extra_holds: int
    missed_fraud: int | None
    false_interventions: int | None
    false_per_1000_legitimate: float | None


class PolicyComparison(BaseModel):
    sampled: int = 0
    evaluated: int = 0
    candidate_threshold: Literal[35] = 35
    extra_holds: int = 0
    fraud_labelled: int = 0
    legitimate_labelled: int = 0
    baseline_detected: int = 0
    candidate_detected: int = 0
    baseline_false_interventions: int = 0
    candidate_false_interventions: int = 0
    first_sample_at: datetime | None = None
    last_sample_at: datetime | None = None
    label_coverage: float | None = None
    policies: list[PolicyResult] = Field(default_factory=list)


class CaseAnalytics(BaseModel):
    as_of: datetime
    total: int
    open: int
    closed: int
    by_state: dict[str, int]
    by_source: dict[str, int]
    escalated_cases: int
    manually_reviewed_cases: int
    manual_review_share: float
    oldest_current_status_seconds: dict[str, float]
    policy_comparison: PolicyComparison | None = None
    demonstration_only: Literal[True] = True


class ExportEvent(BaseModel):
    code: str
    state: State
    timestamp: datetime


class CaseExport(BaseModel):
    category: Category
    state: State
    source: Literal["owner_demo", "trusted_contact", "guardian_timeout", "guardian_signal"]
    created_at: datetime
    events: list[ExportEvent]
    demonstration_only: Literal[True] = True


LABELS = {
    "OPENED": ("Кейс открыт", "Кейс ашылды"),
    "CALLBACK_OWNER_REQUESTED": (
        "Клиент попросил связаться по делу",
        "Клиент іс бойынша хабарласуды сұрады",
    ),
    "CALLBACK_INVITED": ("Сотрудник предложил обратный звонок", "Қызметкер кері қоңырауды ұсынды"),
    "CALLBACK_ACCEPTED": (
        "Клиент принял предложение о звонке",
        "Клиент қоңырау ұсынысын қабылдады",
    ),
    "CALLBACK_DECLINED": ("Клиент отказался от звонка", "Клиент қоңыраудан бас тартты"),
    "TRANSITION": ("Статус рассмотрения изменён", "Қарау мәртебесі өзгертілді"),
    "ASSIGN": ("Тестовый ответственный изменён", "Тестілік жауапты өзгертілді"),
    "CATEGORIZE": ("Категория изменена", "Санат өзгертілді"),
    "NOTE": ("Внутренняя заметка добавлена", "Ішкі жазба қосылды"),
    "REQUEST_INFORMATION": ("Запрошены уточнения в demo API", "Demo API арқылы нақтылау сұралды"),
    "INFORMATION_RECEIVED": ("Уточнение получено", "Нақтылау алынды"),
}
QUESTIONS = {
    "caller_request": ("Что просил сделать звонящий?", "Қоңырау шалушы не істеуді сұрады?"),
    "remote_access": (
        "Просили установить удалённый доступ?",
        "Қашықтан кіруді орнатуды сұрады ма?",
    ),
    "secrecy_pressure": (
        "Просили сохранить разговор в секрете?",
        "Әңгімені құпия сақтауды сұрады ма?",
    ),
}

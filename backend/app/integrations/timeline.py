"""Read-only projection of persisted core facts and integration audit rows."""

import base64
import hashlib
import hmac
import uuid
from datetime import datetime, timedelta
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict
from sqlalchemy import String, and_, cast, func, literal, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.integrations.errors import IntegrationError
from app.integrations.models import ContactNotification, IntegrationAudit
from app.integrations.nbk_mock.models import ExternalCheck
from app.integrations.run_model import IntegrationRun
from app.models import Transaction

Category = Literal["core", "contact", "gateway", "orchestration"]
Importance = Literal["information", "attention"]


class TimelineEvent(BaseModel):
    id: str
    timestamp: datetime
    category: Category
    importance: Importance
    code: str
    correlation_id: uuid.UUID | None
    description_ru: str
    description_kk: str
    source: Literal["persisted_core", "integration_audit"]


class TimelinePage(BaseModel):
    transaction_id: uuid.UUID
    as_of: datetime
    events: list[TimelineEvent]
    next_cursor: str | None
    advisory_only: Literal[True] = True


class Cursor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    transaction_id: uuid.UUID
    as_of: AwareDatetime
    after: AwareDatetime
    event_id: str


# Importance is a display label derived from the saved event, not a new risk score.
LABELS: dict[str, tuple[Category, Importance, str, str]] = {
    "TRANSFER_EVALUATED": ("core", "information", "Перевод проверен", "Аударым тексерілді"),
    "DECISION_APPROVED": ("core", "information", "Решение: одобрен", "Шешім: мақұлданды"),
    "DECISION_COOLING_OFF": ("core", "attention", "Решение: период ожидания", "Шешім: күту кезеңі"),
    "DECISION_BLOCKED": ("core", "attention", "Решение: заблокирован", "Шешім: бұғатталды"),
    "COOLING_STARTED": ("core", "attention", "Начат период ожидания", "Күту кезеңі басталды"),
    "COOLING_RESOLVED": (
        "core",
        "information",
        "Проверка ожидания завершена ядром",
        "Күту тексеруін негізгі жүйе аяқтады",
    ),
    "NOTIFICATION_QUEUED": ("contact", "information", "Уведомление в очереди", "Хабарлама кезекте"),
    "NOTIFICATION_RETRY": (
        "contact",
        "information",
        "Повтор отложен после явного отказа",
        "Нақты бас тартудан кейін қайталау кейінге қалды",
    ),
    "NOTIFICATION_SENT": (
        "contact",
        "information",
        "Провайдер принял уведомление",
        "Провайдер хабарламаны қабылдады",
    ),
    "CONTACT_ACKNOWLEDGED": (
        "contact",
        "information",
        "Контакт подтвердил получение",
        "Сенімді адам алғанын растады",
    ),
    "SUSPICION_REPORTED": (
        "contact",
        "attention",
        "Контакт сообщил о подозрении",
        "Сенімді адам күдік туралы хабарлады",
    ),
    "CONTACT_REVOKED": ("contact", "information", "Согласие отозвано", "Келісім қайтарылды"),
    "NOTIFICATION_EXPIRED": (
        "contact",
        "information",
        "Срок уведомления истёк",
        "Хабарламаның мерзімі аяқталды",
    ),
    "DELIVERY_FAILED": ("contact", "attention", "Доставка не подтверждена", "Жеткізу расталмады"),
    "MOCK_GATEWAY_REQUESTED": (
        "gateway",
        "information",
        "Запрошена синтетическая проверка",
        "Синтетикалық тексеру сұралды",
    ),
    "MOCK_GATEWAY_CLEAR": (
        "gateway",
        "information",
        "MOCK: маркеры не найдены",
        "MOCK: белгілер табылмады",
    ),
    "MOCK_GATEWAY_INDICATORS": (
        "gateway",
        "attention",
        "MOCK: синтетические маркеры",
        "MOCK: синтетикалық белгілер",
    ),
    "MOCK_GATEWAY_UNKNOWN": (
        "gateway",
        "attention",
        "MOCK: результат неизвестен",
        "MOCK: нәтиже белгісіз",
    ),
    "MOCK_GATEWAY_UNAVAILABLE": (
        "gateway",
        "attention",
        "MOCK: проверка недоступна",
        "MOCK: тексеру қолжетімсіз",
    ),
    "INTEGRATION_QUEUED": (
        "orchestration",
        "information",
        "Обогащение в очереди",
        "Қосымша тексеру кезекте",
    ),
    "INTEGRATION_STARTED": (
        "orchestration",
        "information",
        "Обогащение начато",
        "Қосымша тексеру басталды",
    ),
    "INTEGRATION_COMPLETE": (
        "orchestration",
        "information",
        "Обогащение завершено",
        "Қосымша тексеру аяқталды",
    ),
    "INTEGRATION_DEGRADED": (
        "orchestration",
        "attention",
        "Обогащение частично доступно",
        "Қосымша тексеру ішінара қолжетімді",
    ),
    "INTEGRATION_FAILED": (
        "orchestration",
        "attention",
        "Обогащение не завершено",
        "Қосымша тексеру аяқталмады",
    ),
    "INTEGRATION_EVENT": (
        "orchestration",
        "information",
        "Сохранено событие интеграции",
        "Интеграция оқиғасы сақталды",
    ),
}


def event(key: str, at: datetime, code: str, correlation: uuid.UUID | None) -> TimelineEvent:
    safe_code = code if code in LABELS else "INTEGRATION_EVENT"
    category, importance, ru, kk = LABELS[safe_code]
    return TimelineEvent(
        id=key,
        timestamp=at,
        code=safe_code,
        category=category,
        importance=importance,
        correlation_id=correlation,
        description_ru=ru,
        description_kk=kk,
        source="persisted_core" if key.startswith("core:") else "integration_audit",
    )


def encode_cursor(cursor: Cursor, key: str) -> str:
    body = base64.urlsafe_b64encode(cursor.model_dump_json().encode()).decode().rstrip("=")
    signature = hmac.new(key.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{signature}"


def decode_cursor(value: str, transaction_id: uuid.UUID, key: str) -> Cursor:
    try:
        body, signature = value.split(".")
        expected = hmac.new(key.encode(), body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError
        cursor = Cursor.model_validate_json(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if (
            cursor.transaction_id != transaction_id
            or not utcnow() - timedelta(minutes=15) <= cursor.as_of <= utcnow()
            or cursor.after > cursor.as_of
        ):
            raise ValueError
        return cursor
    except (ValueError, TypeError) as exc:
        raise IntegrationError(422, "invalid_or_expired_timeline_cursor") from exc


async def timeline(
    session: AsyncSession,
    transaction_id: uuid.UUID,
    key: str,
    *,
    limit: int = 50,
    cursor: str | None = None,
) -> TimelinePage:
    tx = await session.get(Transaction, transaction_id)
    if tx is None:
        raise IntegrationError(404, "transaction_not_found")
    position = decode_cursor(cursor, tx.id, key) if cursor else None
    as_of = position.as_of if position else utcnow()
    # A resolved cooling transfer retains cooling_until. Do not rewrite its initial
    # decision using today's mutable status; no new historical decision is invented.
    initial = "cooling_off" if tx.cooling_until is not None else tx.status.value
    events = [
        event(f"core:0:{tx.id.hex}", tx.created_at, "TRANSFER_EVALUATED", None),
        event(f"core:1:{tx.id.hex}", tx.created_at, f"DECISION_{initial.upper()}", None),
    ]
    if tx.cooling_until is not None:
        events.append(event(f"core:2:{tx.id.hex}", tx.created_at, "COOLING_STARTED", None))
    if tx.resolved_at is not None:
        events.append(event(f"core:3:{tx.id.hex}", tx.resolved_at, "COOLING_RESOLVED", None))
    events = [
        e
        for e in events
        if e.timestamp <= as_of
        and (position is None or (e.timestamp, e.id) > (position.after, position.event_id))
    ]
    resources = union_all(
        select(ContactNotification.id).where(ContactNotification.transaction_id == tx.id),
        select(ExternalCheck.id).where(ExternalCheck.transaction_id == tx.id),
        select(IntegrationRun.id).where(IntegrationRun.transaction_id == tx.id),
    )
    audit_key = literal("audit:") + func.replace(cast(IntegrationAudit.id, String), "-", "")
    query = select(IntegrationAudit).where(
        IntegrationAudit.resource_id.in_(resources),
        IntegrationAudit.owner_id == tx.sender_id,
        IntegrationAudit.created_at <= as_of,
    )
    if position:
        query = query.where(
            or_(
                IntegrationAudit.created_at > position.after,
                and_(IntegrationAudit.created_at == position.after, audit_key > position.event_id),
            )
        )
    rows = await session.scalars(
        query.order_by(IntegrationAudit.created_at, audit_key).limit(limit + 1)
    )
    events.extend(event(f"audit:{r.id.hex}", r.created_at, r.event, r.correlation_id) for r in rows)
    events.sort(key=lambda e: (e.timestamp, e.id))
    more = len(events) > limit
    page = events[:limit]
    next_cursor = (
        encode_cursor(
            Cursor(
                transaction_id=tx.id,
                as_of=as_of,
                after=page[-1].timestamp,
                event_id=page[-1].id,
            ),
            key,
        )
        if more
        else None
    )
    return TimelinePage(transaction_id=tx.id, as_of=as_of, events=page, next_cursor=next_cursor)

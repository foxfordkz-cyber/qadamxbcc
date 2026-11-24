"""Operation-bound reviews in the synthetic wallet. Financial decisions stay in TransferService."""

import asyncio
import hashlib
import logging
import uuid
from datetime import timedelta
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.base import utcnow
from app.integrations.audit import record
from app.integrations.cases.models import CaseEvent, FraudCase
from app.integrations.cases.schemas import CaseOut
from app.integrations.models import ContactNotification, GuardianReport
from app.integrations.telegram.schemas import NotificationState
from app.models import Transaction, TransactionStatus
from app.models.family_approval import FamilyApproval

SYSTEM = uuid.uuid5(uuid.NAMESPACE_URL, "saqbol:guardian-deadline")


async def review(
    db: AsyncSession, tx: Transaction, *, trigger: Literal["appeal", "deadline", "suspicion"]
) -> uuid.UUID:
    key = uuid.uuid5(tx.id, "saqbol:hold-review")
    now = utcnow()
    prior = await db.get(FraudCase, key)
    if prior:
        if prior.expires_at <= now:
            raise HTTPException(410, "case_expired")
        return prior.report_id
    if tx.status != TransactionStatus.COOLING_OFF:
        raise HTTPException(409, "transfer_not_held")
    automated = trigger != "appeal"
    digest = hashlib.sha256(key.bytes).hexdigest()
    report = GuardianReport(
        id=key,
        owner_id=tx.sender_id,
        transaction_id=tx.id,
        idempotency_key=uuid.uuid5(key, trigger),
        content_hash=digest,
        category="other",
        state="SUBMITTED",
        description=(
            "Истёк срок ожидания доверенного контакта. Ответ не зарегистрирован."
            if trigger == "deadline"
            else "Доверенный контакт отметил перевод как подозрительный."
            if trigger == "suspicion"
            else "Клиент сообщает, что сам инициировал перевод и просит проверить задержку."
        ),
        expires_at=now + timedelta(days=7),
    )
    case = FraudCase(
        id=key,
        report_id=key,
        source=report.source,
        category="other",
        state="NEW",
        version=1,
        created_at=now,
        status_since=now,
        expires_at=report.expires_at,
    )
    event = CaseEvent(
        case_id=key,
        version=1,
        key=key,
        actor_id=SYSTEM if automated else tx.sender_id,
        actor_role="system" if automated else "owner",
        request_hash=digest,
        code="OPENED",
        state="NEW",
        result={"case": CaseOut.model_validate(case).model_dump(mode="json"), "reason": None},
    )
    try:
        db.add_all([report, case])
        await db.flush()
        db.add(event)
        record(
            db,
            tx.sender_id,
            key,
            key,
            {
                "deadline": "GUARDIAN_WAIT_EXPIRED",
                "suspicion": "GUARDIAN_SUSPICION_ESCALATED",
                "appeal": "CLIENT_REVIEW_REQUESTED",
            }[trigger],
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        if not await db.get(FraudCase, key):
            raise
    return key


async def escalate_due(factory: async_sessionmaker[AsyncSession]) -> None:
    now = utcnow()
    deadline = func.coalesce(FamilyApproval.expires_at, ContactNotification.expires_at)
    unanswered = ContactNotification.state.in_(
        [
            NotificationState.QUEUED,
            NotificationState.SENT,
            NotificationState.FAILED,
            NotificationState.EXPIRED,
        ]
    ) | (
        FamilyApproval.transaction_id.is_not(None)
        & (ContactNotification.state == NotificationState.ACKNOWLEDGED)
    )
    due = (
        select(Transaction.id, ContactNotification.state)
        .join(ContactNotification, ContactNotification.transaction_id == Transaction.id)
        .outerjoin(FamilyApproval, FamilyApproval.transaction_id == Transaction.id)
        .where(
            Transaction.status == TransactionStatus.COOLING_OFF,
            ContactNotification.owner_id == Transaction.sender_id,
            or_(
                FamilyApproval.transaction_id.is_(None),
                FamilyApproval.contact_id == ContactNotification.contact_id,
            ),
            deadline > now - timedelta(days=7),
            or_(
                ContactNotification.state == NotificationState.SUSPICION,
                (deadline <= now) & unanswered & FamilyApproval.approved_at.is_(None),
            ),
            ~exists(
                select(GuardianReport.id)
                .join(FraudCase, FraudCase.report_id == GuardianReport.id)
                .where(
                    GuardianReport.transaction_id == Transaction.id,
                    FraudCase.id == GuardianReport.id,
                )
            ),
        )
        .order_by(deadline, Transaction.id)
    )
    async with factory() as db:
        ids = [row[0] for row in (await db.execute(due.limit(32))).all()]
    for key in ids:
        async with factory() as db:
            tx = await db.scalar(select(Transaction).where(Transaction.id == key).with_for_update())
            state = (await db.execute(due.where(Transaction.id == key).limit(1))).first()
            if tx and state:
                await review(
                    db,
                    tx,
                    trigger="suspicion" if state[1] == NotificationState.SUSPICION else "deadline",
                )


async def monitor(factory: async_sessionmaker[AsyncSession]) -> None:
    while True:
        try:
            await escalate_due(factory)
        except SQLAlchemyError:
            logging.getLogger(__name__).warning("Guardian deadline check unavailable")
        await asyncio.sleep(15)

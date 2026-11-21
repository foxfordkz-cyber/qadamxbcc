"""A second participant may confirm only the terms of one customer-authorized transfer."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.audit import record
from app.integrations.models import ContactNotification, TrustedContact
from app.integrations.telegram.schemas import ContactState, NotificationState
from app.models.entities import Transaction, TransactionStatus
from app.models.family_approval import FamilyApproval, FamilyApprovalPolicy
from app.services import explain

if TYPE_CHECKING:
    from app.services.antifraud import Evaluation

MIN_AMOUNT = Decimal("250000")
APPROVAL_WINDOW = timedelta(minutes=30)
REQUIRED = "FAMILY_APPROVAL_REQUIRED"


def active(policy: FamilyApprovalPolicy | None, now: datetime) -> bool:
    return policy is not None and (policy.disable_at is None or policy.disable_at > now)


def hold_for_approval(ev: Evaluation) -> Evaluation:
    from app.services.antifraud import COOLING_OFF_THRESHOLD, RiskReason

    score = max(ev.score, COOLING_OFF_THRESHOLD)
    reason = RiskReason(
        REQUIRED,
        "policy",
        score - ev.score,
        "Жаңа алушыға ірі аударым жасау үшін сіз таңдаған жақыныңыздың растауы қажет.",
        "Для крупного перевода новому получателю требуется подтверждение выбранного вами близкого.",
    )
    kk, ru = (
        (ev.headline_kk, ev.headline_ru)
        if ev.decision == TransactionStatus.COOLING_OFF
        else explain.headline(TransactionStatus.COOLING_OFF, minutes=ev.cooling_off_minutes)
    )
    return replace(
        ev,
        decision=TransactionStatus.COOLING_OFF,
        score=score,
        reasons=[*ev.reasons, reason],
        headline_kk=kk,
        headline_ru=ru,
    )


async def queue_approval(
    session: AsyncSession, tx: Transaction, policy: FamilyApprovalPolicy, recipient_label: str
) -> None:
    assert tx.cooling_until is not None
    expires = tx.cooling_until + APPROVAL_WINDOW
    notice = ContactNotification(
        owner_id=tx.sender_id,
        contact_id=policy.contact_id,
        transaction_id=tx.id,
        expires_at=expires,
        state=NotificationState.QUEUED,
    )
    session.add_all(
        [
            notice,
            FamilyApproval(
                transaction_id=tx.id,
                contact_id=policy.contact_id,
                recipient_id=tx.recipient_id,
                recipient_label=recipient_label,
                amount=tx.amount,
                currency=tx.currency,
                expires_at=expires,
            ),
        ]
    )
    await session.flush()
    record(session, tx.sender_id, notice.id, notice.correlation_id, notice.state)


def matches_terms(approval: FamilyApproval, tx: Transaction) -> bool:
    return (
        approval.transaction_id == tx.id
        and approval.amount == tx.amount
        and approval.recipient_id == tx.recipient_id
        and approval.currency == tx.currency
    )


async def approval_state(
    session: AsyncSession,
    tx: Transaction,
    now: datetime,
    *,
    required: bool,
    releasing: bool = False,
) -> tuple[str, datetime | None]:
    approval = await session.get(FamilyApproval, tx.id)
    if approval is None:
        return ("unavailable" if required else "none"), None
    if tx.status != TransactionStatus.COOLING_OFF:
        return "closed", approval.expires_at
    if not matches_terms(approval, tx):
        return "unavailable", None
    if now >= approval.expires_at:
        return "expired", approval.expires_at
    query = select(TrustedContact).where(TrustedContact.id == approval.contact_id)
    if releasing:
        query = query.with_for_update(read=True).execution_options(populate_existing=True)
    contact = await session.scalar(query)
    if (
        contact is None
        or contact.owner_id != tx.sender_id
        or contact.state != ContactState.VERIFIED
        or not contact.contact_consented_at
        or not contact.notifications_enabled
    ):
        return "unavailable", approval.expires_at
    notice = await session.scalar(
        select(ContactNotification.state).where(
            ContactNotification.transaction_id == tx.id,
            ContactNotification.owner_id == tx.sender_id,
            ContactNotification.contact_id == approval.contact_id,
        )
    )
    if notice == NotificationState.SUSPICION:
        return "suspicious", approval.expires_at
    if notice not in (
        NotificationState.QUEUED,
        NotificationState.SENT,
        NotificationState.ACKNOWLEDGED,
    ):
        return "unavailable", approval.expires_at
    if approval.approved_at:
        return (
            "unavailable" if notice == NotificationState.QUEUED else "confirmed"
        ), approval.expires_at
    return "pending", approval.expires_at

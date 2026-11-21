"""Owner-visible security messages. Opening an item always reads its current resource."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    ColumnElement,
    Select,
    String,
    and_,
    case,
    cast,
    func,
    literal,
    or_,
    select,
    union_all,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from sqlalchemy.sql.selectable import Subquery

from app.db.base import utcnow
from app.integrations.cases.models import CaseEvent, FraudCase
from app.integrations.models import (
    ContactNotification,
    GuardianReport,
    IntegrationAudit,
    TrustedContact,
)
from app.integrations.telegram.schemas import ContactState, NotificationState
from app.mobile_gateway.callbacks import case_query
from app.models import Transaction, TransactionStatus
from app.models.family_approval import FamilyApproval

LIMIT = 30


def case_messages(owner: UUID, now: datetime) -> Select[str, UUID, str, datetime]:
    other = aliased(CaseEvent)
    last_closure = (
        select(func.max(other.version))
        .where(other.case_id == FraudCase.id, other.code == "TRANSITION", other.state == "CLOSED")
        .correlate(FraudCase)
        .scalar_subquery()
    )
    answerable = and_(
        CaseEvent.code == "REQUEST_INFORMATION",
        FraudCase.state.in_(("IN_REVIEW", "NEEDS_INFORMATION", "ESCALATED")),
        FraudCase.version < 500,
        ~select(other.id).where(other.reply_to == CaseEvent.id).exists(),
    )
    closure = and_(
        FraudCase.state == "CLOSED",
        CaseEvent.code == "TRANSITION",
        CaseEvent.state == "CLOSED",
        CaseEvent.version == last_closure,
    )
    # Reopening is the only mutation allowed on a closed case and consumes one version.
    reopening = and_(
        FraudCase.state.not_in(("CLOSED", "RESOLVED")),
        CaseEvent.code == "TRANSITION",
        CaseEvent.state == "IN_REVIEW",
        CaseEvent.version == last_closure + 1,
    )
    message = case(
        (CaseEvent.code == "REQUEST_INFORMATION", "CASE_INFORMATION_REQUIRED"),
        (CaseEvent.state == "CLOSED", "CASE_REVIEW_CLOSED"),
        else_="CASE_REVIEW_REOPENED",
    )
    return (
        case_query(now)
        .join(CaseEvent, CaseEvent.case_id == FraudCase.id)
        .where(GuardianReport.owner_id == owner, or_(answerable, closure, reopening))
        .with_only_columns(
            literal("report").label("kind"),
            GuardianReport.id.label("object_id"),
            message.label("state"),
            CaseEvent.created_at.label("time"),
        )
    )


def notice_messages(owner: UUID) -> Select[str, UUID, str, datetime]:
    return (
        select(
            literal("transfer").label("kind"),
            ContactNotification.transaction_id.label("object_id"),
            IntegrationAudit.event.label("state"),
            IntegrationAudit.created_at.label("time"),
        )
        .join_from(
            IntegrationAudit,
            ContactNotification,
            IntegrationAudit.resource_id == ContactNotification.id,
        )
        .join(Transaction, Transaction.id == ContactNotification.transaction_id)
        .where(
            IntegrationAudit.owner_id == owner,
            ContactNotification.owner_id == owner,
            Transaction.sender_id == owner,
            IntegrationAudit.event.in_(
                ("CONTACT_ACKNOWLEDGED", "SUSPICION_REPORTED", "FAMILY_APPROVAL_RECORDED")
            ),
        )
    )


def active_family_messages(owner: UUID, now: datetime) -> Select[str, UUID, str, datetime]:
    # A suspicion from ANY contact vetoes release, including after the selected signer approved.
    other_notice = aliased(ContactNotification)
    suspicion = (
        select(other_notice.id)
        .where(
            other_notice.transaction_id == Transaction.id,
            other_notice.owner_id == owner,
            other_notice.state == NotificationState.SUSPICION,
        )
        .exists()
    )
    return (
        notice_messages(owner)
        .join(FamilyApproval, FamilyApproval.transaction_id == Transaction.id)
        .join(TrustedContact, TrustedContact.id == FamilyApproval.contact_id)
        .where(
            IntegrationAudit.event == "FAMILY_APPROVAL_RECORDED",
            Transaction.status == TransactionStatus.COOLING_OFF,
            FamilyApproval.approved_at.is_not(None),
            FamilyApproval.expires_at > now,
            FamilyApproval.amount == Transaction.amount,
            FamilyApproval.currency == Transaction.currency,
            FamilyApproval.recipient_id == Transaction.recipient_id,
            ContactNotification.contact_id == FamilyApproval.contact_id,
            ContactNotification.state.in_((NotificationState.SENT, NotificationState.ACKNOWLEDGED)),
            TrustedContact.owner_id == owner,
            TrustedContact.state == ContactState.VERIFIED,
            TrustedContact.contact_consented_at.is_not(None),
            TrustedContact.notifications_enabled.is_(True),
            ~suspicion,
        )
    )


def feed_order(source: Subquery, prioritize_questions: bool) -> list[ColumnElement[Any]]:
    order = [source.c.time.desc(), source.c.kind, source.c.object_id, source.c.state]
    if prioritize_questions:
        order.insert(0, case((source.c.state == "CASE_INFORMATION_REQUIRED", 0), else_=1))
    return order


def history_messages(owner: UUID, now: datetime) -> list[Select[str, UUID, str, datetime]]:
    return [
        select(
            literal("transfer").label("kind"),
            Transaction.id.label("object_id"),
            cast(Transaction.status, String).label("state"),
            func.coalesce(Transaction.resolved_at, Transaction.created_at).label("time"),
        ).where(Transaction.sender_id == owner),
        select(
            literal("contact").label("kind"),
            TrustedContact.id.label("object_id"),
            TrustedContact.state.label("state"),
            func.coalesce(TrustedContact.contact_consented_at, TrustedContact.created_at).label(
                "time"
            ),
        ).where(TrustedContact.owner_id == owner),
        select(
            literal("report").label("kind"),
            GuardianReport.id.label("object_id"),
            GuardianReport.state.label("state"),
            GuardianReport.created_at.label("time"),
        ).where(
            GuardianReport.owner_id == owner,
            GuardianReport.contact_id.is_(None),
            GuardianReport.expires_at > now,
            GuardianReport.description.is_not(None),
        ),
        notice_messages(owner),
    ]


async def owner_inbox(
    session: AsyncSession, owner: UUID, *, case_updates: bool, actions_only: bool = False
) -> list[dict[str, Any]]:
    now = utcnow()
    sources = [active_family_messages(owner, now)] if actions_only else history_messages(owner, now)
    if case_updates:
        sources.append(case_messages(owner, now))
    # Bound each source using the same ordering as the final snapshot.
    recent = []
    for query in sources:
        source = query.subquery()
        limited = select(source).order_by(*feed_order(source, actions_only)).limit(LIMIT)
        recent.append(select(limited.subquery()))
    feed = union_all(*recent).subquery()
    result = await session.execute(
        select(feed).order_by(*feed_order(feed, actions_only)).limit(LIMIT)
    )
    return [dict(item) for item in result.mappings()]

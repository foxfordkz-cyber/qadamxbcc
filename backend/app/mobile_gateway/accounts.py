from typing import Any

from fastapi import FastAPI, HTTPException
from sqlalchemy import func, select

from app.api.deps import SessionDep
from app.integrations.models import (
    ContactNotification,
    GuardianReport,
    IntegrationAudit,
    TrustedContact,
)
from app.integrations.telegram.service import CONTACT_LIMIT
from app.mobile_gateway.app import IdentityDep
from app.mobile_gateway.protection_models import PostCall
from app.mobile_gateway.wallet import balance
from app.models import Account, RiskEvent, Transaction, TransactionStatus

RECIPIENTS = {"+77010000002", "+77010000003", "+77010000004"}


def install_accounts(app: FastAPI) -> None:
    @app.get("/mobile/v1/account")
    async def account(principal: IdentityDep, session: SessionDep) -> dict[str, Any]:
        if principal.role != "client":
            raise HTTPException(403, "client_required")
        held = await session.scalar(
            select(func.sum(Transaction.amount)).where(
                Transaction.sender_id == principal.subject,
                Transaction.status == TransactionStatus.COOLING_OFF,
            )
        )
        pause = await session.scalar(
            select(Transaction.id)
            .where(
                Transaction.sender_id == principal.subject,
                Transaction.status == TransactionStatus.COOLING_OFF,
            )
            .order_by(Transaction.created_at.desc())
            .limit(1)
        )
        pending_call = await session.scalar(
            select(Transaction.id)
            .outerjoin(PostCall, PostCall.transaction_id == Transaction.id)
            .where(
                Transaction.sender_id == principal.subject,
                Transaction.active_call.is_(True),
                PostCall.answered_at.is_(None),
                Transaction.status == TransactionStatus.COOLING_OFF,
                ~select(RiskEvent.id)
                .where(
                    RiskEvent.transaction_id == Transaction.id,
                    RiskEvent.rule_code.in_(("POST_CALL_RECOGNIZED", "POST_CALL_SCAM_REPORTED")),
                )
                .exists(),
            )
            .order_by(Transaction.created_at.desc(), Transaction.id.desc())
            .limit(1)
        )
        recipients = (
            await session.scalars(
                select(Account).where(Account.phone.in_(RECIPIENTS)).order_by(Account.full_name)
            )
        ).all()
        customer = await session.get(Account, principal.subject)
        if customer is None:
            raise HTTPException(404, "account_not_found")
        return {
            "display_name": customer.full_name,
            "card_last4": customer.iban[-4:],
            "balance": await balance(session, principal.subject),
            "guardian_username": app.state.guardian_username or None,
            "telegram_mode": app.state.telegram_mode,
            "contact_limit": CONTACT_LIMIT,
            "telegram_bot": app.state.mobile_bot or None,
            "pending_call": pending_call,
            "held": str(held or 0),
            "currency": "KZT",
            "active_pause": pause,
            "recipients": [{"name": row.full_name, "phone": row.phone} for row in recipients],
        }

    @app.get("/mobile/v1/inbox")
    async def inbox(principal: IdentityDep, session: SessionDep) -> dict[str, Any]:
        if principal.role != "client":
            raise HTTPException(403, "client_required")
        owner = principal.subject
        events: list[dict[str, Any]] = []

        def add(kind: str, obj: Any, status: str, when: Any) -> None:
            events.append({"kind": kind, "object_id": str(obj), "state": status, "time": when})

        pauses = (
            await session.scalars(
                select(Transaction)
                .where(
                    Transaction.sender_id == owner,
                )
                .order_by(Transaction.updated_at.desc())
                .limit(30)
            )
        ).all()
        for t in pauses:
            add("transfer", t.id, t.status, t.resolved_at or t.created_at)
        contacts = (
            await session.scalars(
                select(TrustedContact)
                .where(TrustedContact.owner_id == owner)
                .order_by(TrustedContact.created_at.desc())
                .limit(30)
            )
        ).all()
        for c in contacts:
            add("contact", c.id, c.state, c.contact_consented_at or c.created_at)
        reports = (
            await session.scalars(
                select(GuardianReport)
                .where(GuardianReport.owner_id == owner)
                .order_by(GuardianReport.created_at.desc())
                .limit(30)
            )
        ).all()
        for r in reports:
            add("report", r.id, r.state, r.created_at)
        rows = (
            await session.execute(
                select(IntegrationAudit, ContactNotification.transaction_id)
                .join(ContactNotification, IntegrationAudit.resource_id == ContactNotification.id)
                .where(
                    IntegrationAudit.owner_id == owner,
                    ContactNotification.owner_id == owner,
                    IntegrationAudit.event.in_(["CONTACT_ACKNOWLEDGED", "SUSPICION_REPORTED"]),
                )
                .order_by(IntegrationAudit.created_at.desc())
                .limit(30)
            )
        ).all()
        for audit, tx in rows:
            add("transfer", tx, audit.event, audit.created_at)
        return {"items": sorted(events, key=lambda e: e["time"], reverse=True)[:30]}

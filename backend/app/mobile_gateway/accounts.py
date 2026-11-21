from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from sqlalchemy import func, select

from app.api.deps import SessionDep
from app.api.v1.payee_check import RECIPIENTS
from app.integrations.telegram.service import CONTACT_LIMIT
from app.mobile_gateway.app import IdentityDep
from app.mobile_gateway.protection_models import PostCall
from app.mobile_gateway.security_inbox import owner_inbox
from app.mobile_gateway.wallet import balance
from app.models import Account, RiskEvent, Transaction, TransactionStatus


def install_accounts(app: FastAPI, *, integrations_enabled: bool) -> None:
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
    async def inbox(
        principal: IdentityDep, session: SessionDep, view: Literal["all", "actions"] = "all"
    ) -> dict[str, Any]:
        if principal.role != "client":
            raise HTTPException(403, "client_required")
        return {
            "items": await owner_inbox(
                session,
                principal.subject,
                case_updates=integrations_enabled,
                actions_only=view == "actions",
            )
        }

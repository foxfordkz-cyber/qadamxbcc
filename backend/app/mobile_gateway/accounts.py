from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import Field
from sqlalchemy import func, select

from app.api.deps import EngineDep, SessionDep
from app.api.v1.payee_check import (
    DIRECTORY,
    Payee,
    PayeeLookup,
    PayeeRequest,
    account_verdict,
    check_payee,
)
from app.integrations.telegram.service import CONTACT_LIMIT
from app.mobile_gateway.app import IdentityDep
from app.mobile_gateway.demo_catalog import SAVED_TRANSFERS, saved_recipients, wallet_recipients
from app.mobile_gateway.protection_models import PostCall
from app.mobile_gateway.security_inbox import owner_inbox
from app.mobile_gateway.wallet import balance
from app.models import Account, RiskEvent, Transaction, TransactionStatus
from app.schemas.transfers import TransferEvaluateRequest
from app.services.transfers import TransferService


class WalletPayeeLookup(PayeeLookup):
    review_amount: Decimal | None = Field(None, gt=0, le=1_000_000_000, decimal_places=2)


class StandardPayeeRequest(WalletPayeeLookup):
    recipient: Payee


class SavedPayeeRequest(WalletPayeeLookup):
    recipient: Literal["saved-1", "saved-2", "saved-3", "saved-4"]


def install_accounts(app: FastAPI, *, integrations_enabled: bool) -> None:
    @app.post("/mobile/v1/api/payee-check")
    async def mobile_payee_check(
        body: StandardPayeeRequest | SavedPayeeRequest,
        principal: IdentityDep,
        session: SessionDep,
        engine: EngineDep,
    ) -> dict[str, Any]:
        if principal.role != "client":
            raise HTTPException(403, "mobile_role_forbidden")
        recipient_id: UUID | None
        if isinstance(body, StandardPayeeRequest):
            checked = await check_payee(
                PayeeRequest(
                    recipient=body.recipient, bank=body.bank, expected_name=body.expected_name
                ),
                session,
            )
            result = checked.model_dump()
            recipient_id = DIRECTORY[body.recipient][0]
        else:
            account = await session.scalar(
                saved_recipients(principal.subject).where(
                    Transaction.id == SAVED_TRANSFERS[body.recipient]
                )
            )
            verdict, name = (
                account_verdict(body, account.full_name, account.iban)
                if account is not None
                else ("unavailable", None)
            )
            result = {
                "recipient": body.recipient,
                "bank": body.bank,
                "status": verdict,
                "display_name": name,
                "source": "synthetic_directory",
            }
            recipient_id = account.id if account is not None else None
        if (
            body.review_amount is not None
            and recipient_id
            and result["status"] in ("identified", "match", "close")
        ):
            payment = TransferEvaluateRequest(
                sender_id=principal.subject, recipient_id=recipient_id, amount=body.review_amount
            )
            result["ask_about_call"] = await TransferService(session, engine).should_ask_about_call(
                payment
            )
        return result

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
        recipients = await wallet_recipients(session, principal.subject)
        customer = await session.get(Account, principal.subject)
        if customer is None:
            raise HTTPException(404, "account_not_found")
        return {
            "display_name": customer.full_name,
            "supports_call_question": True,
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
            "recipients": recipients,
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

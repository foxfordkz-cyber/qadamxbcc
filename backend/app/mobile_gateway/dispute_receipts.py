"""Scoped virtual-balance disputes and verifiable statements for one jury room."""

from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import EngineDep, SessionDep
from app.api.v1.transfers import _http
from app.mobile_gateway.app import Identity, IdentityDep
from app.models import PaymentReturn, Transaction
from app.schemas.returns import Confirmation, ReturnAction, ReturnReview, ReviewState
from app.services import demo_funds
from app.services.payment_returns import ReturnService
from app.services.transfers import DomainError


class DisputeAction(Confirmation):
    action: Literal["report_redirect", "appeal"]


class Statement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issuer: Literal["saq-bol-jury"] = "saq-bol-jury"
    original_id: UUID
    currency: Literal["KZT"] = "KZT"
    original_amount: str = Field(pattern=r"^\d+\.\d{2}$")
    restricted_amount: str = Field(pattern=r"^\d+\.\d{2}$")
    status: ReviewState
    recorded_at: str


class SignedStatement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    statement: Statement
    signature: str = Field(pattern="^[0-9a-f]{128}$")


def install_dispute_receipts(app: FastAPI, owner: UUID) -> None:
    signer = Ed25519PrivateKey.generate()
    base = "/mobile/v1/wallet/disputes/{original_id}"

    def allowed(principal: Identity) -> None:
        if principal.role != "admin" and not (
            principal.role == "client" and principal.subject == owner
        ):
            raise HTTPException(403, "mobile_role_forbidden")

    async def statement(db: AsyncSession, original: UUID) -> Statement:
        try:
            payment = await ReturnService(db, owner).detail(original)
        except DomainError as exc:
            raise _http(exc) from exc
        record = await db.get(PaymentReturn, original)
        updated = (
            (record.reviewed_at or record.appealed_at or record.reported_at) if record else None
        )
        return Statement(
            original_id=original,
            original_amount=format(payment.amount, ".2f"),
            restricted_amount=format(payment.restricted_amount, ".2f"),
            status=payment.review_state,
            recorded_at=(updated or payment.received_at).isoformat(),
        )

    @app.get("/mobile/v1/wallet/disputes")
    async def queue(principal: IdentityDep, session: SessionDep) -> dict[str, Any]:
        if principal.role != "admin":
            raise HTTPException(403, "soc_required")
        rows = (
            await session.execute(
                select(Transaction.id, Transaction.amount, PaymentReturn.reported_at)
                .join(PaymentReturn, PaymentReturn.original_id == Transaction.id)
                .where(
                    Transaction.recipient_id == owner,
                    PaymentReturn.reported_at.is_not(None),
                    PaymentReturn.decision.is_(None),
                )
                .order_by(PaymentReturn.reported_at.desc(), Transaction.id.desc())
                .limit(26)
            )
        ).all()
        return {
            "items": [
                {"id": r.id, "amount": str(r.amount), "at": r.reported_at} for r in rows[:25]
            ],
            "has_more": len(rows) > 25,
        }

    @app.get(base)
    async def view(
        original_id: UUID, principal: IdentityDep, session: SessionDep
    ) -> dict[str, Any]:
        allowed(principal)
        document = await statement(session, original_id)
        total = await demo_funds.disputed_total(session, owner)
        available = max(Decimal(0), await demo_funds.posted_balance(session, owner) - total)
        record = await session.get(PaymentReturn, original_id)
        return {
            "statement": document,
            "available_kzt": format(available, ".2f"),
            "can_appeal": bool(record and record.decision == "uphold" and not record.appealed_at),
            "stage": "appealed" if record and record.appealed_at else "reported",
        }

    @app.post(base + "/report")
    async def report(
        original_id: UUID,
        body: DisputeAction,
        principal: IdentityDep,
        session: SessionDep,
        engine: EngineDep,
    ) -> dict[str, Any]:
        if principal.role != "client" or principal.subject != owner:
            raise HTTPException(403, "client_required")
        try:
            await ReturnService(session, owner).act(
                original_id, ReturnAction(action=body.action, confirmed=True), engine
            )
        except DomainError as exc:
            raise _http(exc) from exc
        return await view(original_id, principal, session)

    @app.post(base + "/review")
    async def review(
        original_id: UUID, body: ReturnReview, principal: IdentityDep, session: SessionDep
    ) -> dict[str, Any]:
        if principal.role != "admin":
            raise HTTPException(403, "soc_required")
        try:
            await ReturnService(session, owner).review(
                original_id, body, f"soc:{principal.subject}"
            )
        except DomainError as exc:
            raise _http(exc) from exc
        return await view(original_id, principal, session)

    @app.get(base + "/statement")
    async def issue(
        original_id: UUID, principal: IdentityDep, session: SessionDep
    ) -> SignedStatement:
        allowed(principal)
        doc = await statement(session, original_id)
        if doc.status == "none":
            raise HTTPException(409, "report_required")
        return SignedStatement(
            statement=doc, signature=signer.sign(doc.model_dump_json().encode()).hex()
        )

    @app.post(base + "/verify")
    async def verify(
        original_id: UUID, body: SignedStatement, principal: IdentityDep, session: SessionDep
    ) -> dict[str, bool]:
        allowed(principal)
        current = await statement(session, original_id)
        try:
            signer.public_key().verify(
                bytes.fromhex(body.signature), body.statement.model_dump_json().encode()
            )
        except InvalidSignature:
            return {"authentic": False, "current": False}
        related = body.statement.original_id == original_id
        return {"authentic": related, "current": related and body.statement == current}

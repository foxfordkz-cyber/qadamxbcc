"""Single-dispute access for the second synthetic participant inside one jury room."""

import hashlib
import secrets
from typing import cast
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import SessionDep
from app.mobile_gateway.app import Identity, IdentityDep
from app.mobile_gateway.dispute_accounts import AccountAnswer, AccountViews, Answer, views
from app.models import PaymentReturn, Transaction


class InvitationReply(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    transfer: UUID
    code: str = Field(min_length=43, max_length=43, pattern=r"^[a-zA-Z0-9_-]+$")
    answer: Answer


async def counterparty(db: AsyncSession, transfer: UUID, owner: UUID) -> UUID:
    found = (
        await db.execute(
            select(Transaction.sender_id, Transaction.recipient_id)
            .join(PaymentReturn, PaymentReturn.original_id == Transaction.id)
            .where(
                Transaction.id == transfer,
                PaymentReturn.reported_at.is_not(None),
                PaymentReturn.decision.is_(None),
            )
        )
    ).one_or_none()
    if found and owner in (found.sender_id, found.recipient_id):
        return cast(UUID, found.recipient_id if owner == found.sender_id else found.sender_id)
    raise HTTPException(404, "open_dispute_required")


def install_jury_interview(app: FastAPI, owner: UUID) -> None:
    def key(transfer: UUID) -> str:
        return "bcc:jury:counterparty:" + str(transfer)

    @app.post("/mobile/v1/wallet/participant-statements/{transfer_id}/jury-invite")
    async def invite(
        transfer_id: UUID, principal: IdentityDep, db: SessionDep, request: Request
    ) -> dict[str, str]:
        if principal.role != "admin":
            raise HTTPException(403, "soc_required")
        await counterparty(db, transfer_id, owner)
        code = secrets.token_urlsafe(32)
        redis: Redis = request.app.state.resources.redis
        try:
            await redis.set(key(transfer_id), hashlib.sha256(code.encode()).hexdigest(), ex=600)
        except RedisError as exc:
            raise HTTPException(503, "interview_unavailable") from exc
        return {"fragment": str(transfer_id) + "." + code}

    @app.post("/mobile/v1/wallet/jury-interview", response_model_exclude_none=True)
    async def reply(body: InvitationReply, db: SessionDep, request: Request) -> AccountViews:
        redis: Redis = request.app.state.resources.redis
        try:
            saved = await redis.get(key(body.transfer))
        except RedisError as exc:
            raise HTTPException(503, "interview_unavailable") from exc
        actual = saved.decode() if isinstance(saved, bytes) else saved
        if not actual or not secrets.compare_digest(
            actual, hashlib.sha256(body.code.encode()).hexdigest()
        ):
            raise HTTPException(403, "invalid_interview")
        subject = await counterparty(db, body.transfer, owner)
        return await views(
            db,
            body.transfer,
            Identity(role="client", subject=subject),
            AccountAnswer(answer=body.answer),
            jury_invite=True,
        )

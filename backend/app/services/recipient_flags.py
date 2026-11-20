"""Durable, versioned SOC account flags; never execute or release a transfer."""

import hashlib
import json
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.db.locks import serialized_identity
from app.models import Account, RecipientFlagAudit
from app.schemas.soc import RecipientFlagRequest, RecipientFlagResponse, RecipientFlagState
from app.services.graph import GraphStore


class FlagError(Exception):
    def __init__(self, status: int, code: str) -> None:
        self.status, self.code = status, code
        super().__init__(code)


def service_actor(key: str | None) -> str:
    # The current boundary identifies a service credential, never an individual
    # analyst. Keep the key itself out of logs, persisted rows and responses.
    return (
        "soc_service:" + hashlib.sha256(key.encode()).hexdigest()[:24] if key else "local_demo_soc"
    )


def _state(account: Account) -> RecipientFlagState:
    return RecipientFlagState(
        account_id=account.id,
        flagged=account.is_flagged,
        version=account.flag_version,
        updated_at=account.flag_updated_at,
    )


def _receipt(audit: RecipientFlagAudit) -> RecipientFlagResponse:
    return RecipientFlagResponse(
        account_id=audit.account_id,
        flagged=audit.flagged,
        previous_flagged=audit.previous_flagged,
        version=audit.version,
        updated_at=audit.created_at,
        audit_id=audit.id,
        actor=audit.actor,
        note=audit.note,
    )


async def state(session: AsyncSession, account_id: uuid.UUID) -> RecipientFlagState:
    account = await session.get(Account, account_id, populate_existing=True)
    if account is None:
        raise FlagError(404, "account_not_found")
    return _state(account)


async def set_flag(
    session: AsyncSession,
    graph: GraphStore,
    account_id: uuid.UUID,
    body: RecipientFlagRequest,
    actor: str,
) -> RecipientFlagResponse:
    payload = {"actor": actor, "body": body.model_dump(mode="json", exclude={"request_id"})}
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    async with serialized_identity(session, account_id):
        account = await session.scalar(
            select(Account)
            .where(Account.id == account_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if account is None:
            raise FlagError(404, "account_not_found")
        if body.request_id is not None:
            prior = await session.scalar(
                select(RecipientFlagAudit).where(
                    RecipientFlagAudit.account_id == account_id,
                    RecipientFlagAudit.request_id == body.request_id,
                )
            )
            if prior is not None:
                if prior.request_hash != digest:
                    raise FlagError(409, "flag_idempotency_conflict")
                return _receipt(prior)
        if body.expected_version is not None and body.expected_version != account.flag_version:
            raise FlagError(409, "flag_version_conflict")
        audit = RecipientFlagAudit(
            id=uuid.uuid4(),
            account_id=account_id,
            request_id=body.request_id,
            request_hash=digest,
            previous_flagged=account.is_flagged,
            flagged=body.flagged,
            version=account.flag_version + 1,
            actor=actor,
            note=body.note,
            created_at=utcnow(),
        )
        account.is_flagged = body.flagged
        account.flag_version = audit.version
        account.flag_updated_at = audit.created_at
        session.add(audit)
        await session.commit()
        # Every worker also refreshes DB flags at evaluation/graph-read boundaries.
        # A delayed local update must not overwrite a later committed revision.
        graph.set_flagged(str(account_id), body.flagged, version=audit.version)
        return _receipt(audit)

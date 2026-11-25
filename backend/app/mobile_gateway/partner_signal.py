"""A fresh, signed case advisory exchanged inside one isolated synthetic jury room."""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import SessionDep
from app.db.base import utcnow
from app.integrations.cases.models import CaseEvent, FraudCase
from app.integrations.models import GuardianReport
from app.mobile_gateway.app import IdentityDep
from app.models import Transaction

State = Literal["review", "withdrawn", "expired", "no_signal"]


class Advisory(BaseModel):
    issuer: Literal["sandbox-a"] = "sandbox-a"
    audience: Literal["sandbox-b"] = "sandbox-b"
    reference: str
    version: int
    state: State
    issued_at: datetime
    expires_at: datetime
    challenge: str


def receive(
    payload: bytes,
    signature: bytes,
    public_key: Ed25519PublicKey,
    challenge: str,
    reference: str,
    now: datetime,
) -> Advisory:
    public_key.verify(signature, payload)
    item = Advisory.model_validate_json(payload)
    if (
        item.challenge != challenge
        or item.reference != reference
        or not item.issued_at <= now < item.expires_at
        or item.expires_at - item.issued_at > timedelta(minutes=5)
    ):
        raise ValueError("invalid_advisory")
    return item


def install_partner_signal(app: FastAPI) -> None:
    issuer_key = Ed25519PrivateKey.generate()
    verifying_key = issuer_key.public_key()
    pseudonym_key = secrets.token_bytes(32)

    @app.get("/mobile/v1/wallet/cases/{case_id}/partner-signal")
    async def check(case_id: UUID, principal: IdentityDep, session: SessionDep) -> Advisory:
        if principal.role != "admin":
            raise HTTPException(403, "soc_required")
        now = utcnow()
        record = (
            await session.execute(
                select(FraudCase, CaseEvent, Transaction.recipient_id, GuardianReport.expires_at)
                .join(GuardianReport, GuardianReport.id == FraudCase.report_id)
                .join(Transaction, Transaction.id == GuardianReport.transaction_id)
                .join(
                    CaseEvent,
                    (CaseEvent.case_id == FraudCase.id) & (CaseEvent.version == FraudCase.version),
                )
                .where(
                    FraudCase.id == case_id,
                    FraudCase.expires_at > now,
                    GuardianReport.expires_at > now,
                )
            )
        ).one_or_none()
        if record is None:
            raise HTTPException(404, "linked_case_required")
        case, event, recipient_id, report_expires = record
        last_fraud = await session.scalar(
            select(CaseEvent.created_at)
            .where(
                CaseEvent.case_id == case.id,
                CaseEvent.version <= case.version,
                CaseEvent.code == "TRANSITION",
                CaseEvent.state == "CLOSED",
                CaseEvent.result["reason"].as_string() == "confirmed_fraud",
            )
            .order_by(CaseEvent.version.desc())
            .limit(1)
        )
        state: State = "no_signal"
        until = min(now + timedelta(minutes=5), case.expires_at, report_expires)
        if last_fraud:
            if case.state != "CLOSED" or event.result.get("reason") != "confirmed_fraud":
                state = "withdrawn"
            elif now >= last_fraud + timedelta(hours=24):
                state = "expired"
            else:
                state = "review"
                until = min(until, last_fraud + timedelta(hours=24))
        # This reference is specific to the receiving institution and case. The receiver
        # does not get an account number, a narrative, an amount, or the sender's identity.
        reference = hmac.digest(
            pseudonym_key, b"sandbox-b:" + case_id.bytes + recipient_id.bytes, hashlib.sha256
        ).hex()[:24]
        challenge = secrets.token_urlsafe(24)
        advisory = Advisory(
            reference=reference,
            state=state,
            version=case.version,
            issued_at=now,
            expires_at=until,
            challenge=challenge,
        )
        envelope = advisory.model_dump_json().encode()
        return receive(
            envelope, issuer_key.sign(envelope), verifying_key, challenge, reference, now
        )

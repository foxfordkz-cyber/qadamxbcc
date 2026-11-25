"""Optional transaction-bound WebAuthn for the owner of an isolated jury wallet."""

import hashlib
import json
import secrets
from datetime import timedelta
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, ValidationError
from redis.exceptions import RedisError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.api.deps import SessionDep
from app.db.base import utcnow
from app.mobile_gateway.app import Identity, IdentityDep, check_web_origin, digest
from app.mobile_gateway.demo_catalog import allowed_recipient
from app.mobile_gateway.protection_models import SignedIntent, TransferKey
from app.models import Account, Transaction
from app.schemas.transfers import TransferEvaluateRequest

TTL = 120
PREFIX = "/mobile/v1/protection/transfer-key"


class Proof(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ceremony: UUID
    credential: dict[str, Any]


class Terms(BaseModel):
    request_id: UUID
    recipient_id: UUID
    amount_tiyn: int
    fingerprint: str


class Ceremony(BaseModel):
    challenge: str
    terms: Terms | None


async def payment_terms(
    session: AsyncSession, owner: UUID, body: dict[str, Any]
) -> tuple[Terms, dict[str, Any]]:
    try:
        payment = TransferEvaluateRequest.model_validate({"sender_id": str(owner)} | body)
    except ValidationError as exc:
        raise HTTPException(422, "mobile_input_invalid") from exc
    if payment.sender_id != owner or not payment.request_id:
        raise HTTPException(422, "mobile_input_invalid")
    if not await allowed_recipient(session, owner, payment.recipient_phone):
        raise HTTPException(422, "mobile_recipient_unavailable")
    recipient = await session.scalar(
        select(Account.id).where(Account.phone == payment.recipient_phone)
    )
    if not recipient:
        raise HTTPException(422, "mobile_recipient_unavailable")
    # Resolve the locator once. The core receives the exact account covered by the proof.
    resolved = payment.model_dump(mode="json", exclude_none=True)
    del resolved["recipient_phone"]
    resolved.update(recipient_id=str(recipient), amount=format(payment.amount, ".2f"))
    fingerprint = digest(json.dumps(resolved, sort_keys=True, separators=(",", ":")))
    return Terms(
        request_id=payment.request_id,
        recipient_id=recipient,
        amount_tiyn=int(payment.amount * 100),
        fingerprint=fingerprint,
    ), resolved


async def authorize_payment(
    request: Request,
    session: AsyncSession,
    principal: Identity,
    body: dict[str, Any],
    existing: Transaction | None,
) -> dict[str, Any]:
    if not await session.get(TransferKey, principal.subject):
        return body
    terms, resolved = await payment_terms(session, principal.subject, body)
    grant = await session.get(SignedIntent, terms.request_id)
    if not (
        grant
        and grant.owner_id == principal.subject
        and grant.recipient_id == terms.recipient_id
        and grant.session_hash == digest(request.state.session_token)
        and secrets.compare_digest(grant.fingerprint, terms.fingerprint)
        and (existing is not None or utcnow() < grant.verified_at + timedelta(seconds=TTL))
    ):
        raise HTTPException(428, "transfer_signature_required")
    return resolved


def install_transfer_keys(app: FastAPI, origin: str) -> None:
    url = urlsplit(origin)
    if (
        not url.hostname
        or url.username
        or url.password
        or origin != f"{url.scheme}://{url.netloc}"
        or not (url.scheme == "https" or (url.scheme == "http" and url.hostname == "localhost"))
    ):
        raise ValueError("Set an exact HTTPS origin or an HTTP localhost origin for WebAuthn")
    rp_id: str = url.hostname

    def ceremony_key(request: Request, principal: Identity, purpose: str, ceremony: UUID) -> str:
        if principal.role != "client":
            raise HTTPException(403, "client_required")
        check_web_origin(request)
        if request.headers.get("origin") != origin:
            raise HTTPException(403, "transfer_key_origin")
        session_hash = digest(request.state.session_token)
        return f"bcc:mobile:key:{principal.subject}:{session_hash}:{purpose}:{ceremony}"

    async def start(
        request: Request, principal: Identity, purpose: str, challenge: bytes, terms: Terms | None
    ) -> UUID:
        ceremony = uuid4()
        key = ceremony_key(request, principal, purpose, ceremony)
        try:
            await request.app.state.resources.redis.set(
                key, Ceremony(challenge=challenge.hex(), terms=terms).model_dump_json(), ex=TTL
            )
        except RedisError as exc:
            raise HTTPException(503, "mobile_unavailable") from exc
        return ceremony

    async def consume(
        request: Request, principal: Identity, purpose: str, proof: Proof
    ) -> Ceremony:
        key = ceremony_key(request, principal, purpose, proof.ceremony)
        try:
            raw = await request.app.state.resources.redis.getdel(key)
        except RedisError as exc:
            raise HTTPException(503, "mobile_unavailable") from exc
        if raw is None:
            raise HTTPException(409, "transfer_key_challenge_expired")
        return Ceremony.model_validate_json(raw)

    @app.post(PREFIX + "/register/options")
    async def enroll(
        request: Request, principal: IdentityDep, session: SessionDep
    ) -> dict[str, Any]:
        if principal.role != "client":
            raise HTTPException(403, "client_required")
        if await session.get(TransferKey, principal.subject):
            raise HTTPException(409, "transfer_key_already_enrolled")
        options = generate_registration_options(
            rp_id=rp_id,
            rp_name="Saq Bol × BCC",
            user_name="Saq Bol · jury",
            user_id=secrets.token_bytes(32),
            timeout=TTL * 1000,
            authenticator_selection=AuthenticatorSelectionCriteria(
                user_verification=UserVerificationRequirement.REQUIRED,
                resident_key=ResidentKeyRequirement.DISCOURAGED,
            ),
        )
        ceremony = await start(request, principal, "register", options.challenge, None)
        return {"ceremony": ceremony, "publicKey": json.loads(options_to_json(options))}

    @app.post(PREFIX + "/register/finish")
    async def register(
        proof: Proof, request: Request, principal: IdentityDep, session: SessionDep
    ) -> dict[str, bool]:
        challenge = await consume(request, principal, "register", proof)
        try:
            result = verify_registration_response(
                credential=proof.credential,
                expected_rp_id=rp_id,
                expected_origin=origin,
                expected_challenge=bytes.fromhex(challenge.challenge),
                require_user_verification=True,
            )
        except (WebAuthnException, ValueError, TypeError, KeyError) as exc:
            raise HTTPException(422, "transfer_key_invalid") from exc
        session.add(
            TransferKey(
                owner_id=principal.subject,
                credential_id=result.credential_id,
                public_key=result.credential_public_key,
                sign_count=result.sign_count,
            )
        )
        try:
            await session.commit()
        except IntegrityError as exc:
            raise HTTPException(409, "transfer_key_already_enrolled") from exc
        return {"enrolled": True}

    @app.post(PREFIX + "/payment/options")
    async def payment(
        body: dict[str, Any], request: Request, principal: IdentityDep, session: SessionDep
    ) -> dict[str, Any]:
        if principal.role != "client":
            raise HTTPException(403, "client_required")
        device = await session.get(TransferKey, principal.subject)
        if device is None:
            raise HTTPException(409, "transfer_key_missing")
        terms, _ = await payment_terms(session, principal.subject, body)
        try:
            owner = await request.app.state.resources.redis.get(
                f"bcc:mobile:request:{terms.request_id}"
            )
        except RedisError as exc:
            raise HTTPException(503, "mobile_unavailable") from exc
        if owner not in (str(principal.subject), str(principal.subject).encode()):
            raise HTTPException(404, "mobile_request_id_required")
        if await session.scalar(
            select(Transaction.id).where(Transaction.request_id == terms.request_id)
        ):
            raise HTTPException(409, "transfer_already_evaluated")
        challenge = hashlib.sha256(
            secrets.token_bytes(32) + bytes.fromhex(terms.fingerprint)
        ).digest()
        options = generate_authentication_options(
            rp_id=rp_id,
            challenge=challenge,
            timeout=TTL * 1000,
            user_verification=UserVerificationRequirement.REQUIRED,
            allow_credentials=[PublicKeyCredentialDescriptor(id=device.credential_id)],
        )
        ceremony = await start(request, principal, "payment", challenge, terms)
        return {"ceremony": ceremony, "publicKey": json.loads(options_to_json(options))}

    @app.post(PREFIX + "/payment/finish")
    async def sign(
        proof: Proof, request: Request, principal: IdentityDep, session: SessionDep
    ) -> dict[str, bool]:
        challenge = await consume(request, principal, "payment", proof)
        device = await session.get(TransferKey, principal.subject)
        if device is None or challenge.terms is None:
            raise HTTPException(409, "transfer_key_missing")
        try:
            assertion = verify_authentication_response(
                credential=proof.credential,
                expected_rp_id=rp_id,
                expected_origin=origin,
                expected_challenge=bytes.fromhex(challenge.challenge),
                require_user_verification=True,
                credential_public_key=device.public_key,
                credential_current_sign_count=device.sign_count,
            )
        except (WebAuthnException, ValueError, TypeError, KeyError) as exc:
            raise HTTPException(422, "transfer_key_invalid") from exc
        if not secrets.compare_digest(assertion.credential_id, device.credential_id):
            raise HTTPException(422, "transfer_key_invalid")
        changed = await session.scalar(
            update(TransferKey)
            .where(
                TransferKey.owner_id == principal.subject,
                TransferKey.sign_count == device.sign_count,
            )
            .values(sign_count=assertion.new_sign_count)
            .returning(TransferKey.owner_id)
        )
        if not changed:
            raise HTTPException(409, "transfer_key_conflict")
        session.add(
            SignedIntent(
                **challenge.terms.model_dump(),
                owner_id=principal.subject,
                verified_at=utcnow(),
                session_hash=digest(request.state.session_token),
            )
        )
        try:
            await session.commit()
        except IntegrityError as exc:
            raise HTTPException(409, "transfer_already_signed") from exc
        return {"verified": True}

    @app.get(PREFIX + "/receipts/{transaction_id}")
    async def receipt(
        transaction_id: UUID, principal: IdentityDep, session: SessionDep
    ) -> dict[str, Any]:
        tx = await session.get(Transaction, transaction_id)
        if (
            tx is None
            or principal.role == "platform_admin"
            or (principal.role == "client" and tx.sender_id != principal.subject)
        ):
            raise HTTPException(404, "mobile_transaction_not_found")
        intent = await session.get(SignedIntent, tx.request_id) if tx.request_id else None
        if (
            not intent
            or intent.owner_id != tx.sender_id
            or intent.recipient_id != tx.recipient_id
            or tx.currency != "KZT"
            or intent.amount_tiyn != int(tx.amount * 100)
            or intent.verified_at > tx.created_at
        ):
            return {"verified": False}
        return {
            "verified": True,
            "verified_at": intent.verified_at,
            "amount": str(tx.amount),
            "recipient_id": tx.recipient_id,
            "currency": tx.currency,
        }

"""Historical settlement proof from the jury's independent clearing register."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

ProofState = Literal["valid", "missing", "future", "expired", "revoked", "mismatch", "untrusted"]
JURY_CLEARING = "jury-clearing-register"


@dataclass(frozen=True)
class Settlement:
    reference: str
    payer: str
    payee: str
    amount_tiyn: int
    currency: str = "KZT"


@dataclass(frozen=True)
class ClearingProof:
    issuer: str
    settlement: Settlement
    issued_at: datetime
    received_at: datetime
    expires_at: datetime
    revoked_at: datetime | None = None


def proof_state(proof: ClearingProof | None, posting: Settlement, as_of: datetime) -> ProofState:
    if proof is None:
        return "missing"
    if proof.issuer != JURY_CLEARING:
        return "untrusted"
    if proof.issued_at > proof.received_at or as_of < proof.received_at:
        return "future"
    if proof.revoked_at is not None and proof.revoked_at <= as_of:
        return "revoked"
    if as_of >= proof.expires_at:
        return "expired"
    return "valid" if proof.settlement == posting else "mismatch"

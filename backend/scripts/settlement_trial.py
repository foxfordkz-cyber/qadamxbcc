"""Build the paired, read-only clearing-proof exhibit with the actual hybrid scorer."""

import asyncio
import json
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from random import Random
from typing import Literal, TypedDict

from fakeredis import FakeAsyncRedis

from app.services.antifraud import AntifraudEngine, TransferContext
from app.services.graph import GraphStore
from app.services.settlement_evidence import (
    JURY_CLEARING,
    ClearingProof,
    ProofState,
    Settlement,
    proof_state,
)

AS_OF = datetime(2026, 11, 25, 9, 15, tzinfo=UTC)
OUTPUT = Path(__file__).resolve().parents[2] / "frontend/src/lib/settlement-trial.json"
Mode = Literal["valid", "expired", "revoked", "future", "mismatch", "flagged"]
MODES: tuple[Mode, ...] = ("valid", "expired", "revoked", "future", "mismatch", "flagged")
NETWORK_ONLY = {
    "FAN_IN_VELOCITY",
    "DROP_HUB_FAN_IN",
    "RECIPIENT_MANY_SENDERS",
    "RECIPIENT_INSTANT_CASHOUT",
    "RECIPIENT_TRANSIT_RATIO",
    "FAN_IN_UNCORROBORATED",
    "ML_RISK_UPLIFT",
}


@dataclass(frozen=True)
class Score:
    score: int
    decision: str


@dataclass(frozen=True)
class Result:
    proof: ProofState
    observed: Score
    contextual: Score
    received_at: str
    expires_at: str
    revoked_at: str | None


class Counts(TypedDict):
    honest: int
    fraud: int
    false_pauses: int
    caught: int


async def project(
    incoming: tuple[TransferContext, ...], outgoing: TransferContext | None, flagged: bool
) -> tuple[Score, set[str]]:
    async with FakeAsyncRedis() as redis:
        engine = AntifraudEngine(redis, GraphStore())
        history = incoming if outgoing is None else (*incoming, outgoing)
        for tx in history:
            await engine.velocity.record_attempt(
                tx_id=tx.tx_id,
                sender_id=tx.sender_id,
                recipient_id=tx.recipient_id,
                amount=tx.amount,
                ts=tx.occurred_at.timestamp(),
            )
            await engine.record_settled(tx)
            engine.apply_transfer(tx)
        probe = replace(
            incoming[0], tx_id="next-payment", occurred_at=AS_OF, recipient_flagged=flagged
        )
        decision = await engine.evaluate(probe, record_attempt=False)
        return Score(decision.score, decision.decision.value), {r.code for r in decision.reasons}


async def compare(mode: Mode, senders: int, payment: int) -> Result:
    before = AS_OF - timedelta(minutes=15)
    incoming = tuple(
        TransferContext(
            tx_id=f"in-{i}",
            sender_id=f"member-{i}",
            recipient_id="fund",
            device_id=f"device-{i}",
            amount=payment,
            sender_avg_amount=payment,
            occurred_at=before + timedelta(seconds=30 * i),
        )
        for i in range(senders)
    )
    amount = payment * senders * 9 // 10
    outgoing = replace(
        incoming[0],
        tx_id="invoice-1",
        sender_id="fund",
        recipient_id="supplier",
        amount=amount,
        occurred_at=AS_OF - timedelta(minutes=1),
    )
    posting = Settlement(outgoing.tx_id, outgoing.sender_id, outgoing.recipient_id, amount * 100)
    proof = ClearingProof(JURY_CLEARING, posting, before, before, AS_OF + timedelta(hours=1))
    if mode == "expired":
        proof = replace(proof, expires_at=AS_OF - timedelta(seconds=1))
    elif mode == "revoked":
        proof = replace(proof, revoked_at=AS_OF - timedelta(seconds=1))
    elif mode == "future":
        proof = replace(proof, received_at=AS_OF + timedelta(minutes=1))
    elif mode == "mismatch":
        proof = replace(proof, settlement=replace(posting, payee="other-supplier"))
    state = proof_state(proof, posting, AS_OF)
    baseline, reasons = await project(incoming, outgoing, mode == "flagged")
    adjusted = baseline
    # Only this matched historical payout can be attributed to clearing. A separate
    # risk signal leaves the full original decision in force, including a reviewed flag.
    if state == "valid" and reasons <= NETWORK_ONLY:
        adjusted, _ = await project(incoming, None, False)
    return Result(
        state,
        baseline,
        adjusted,
        proof.received_at.isoformat(),
        proof.expires_at.isoformat(),
        proof.revoked_at.isoformat() if proof.revoked_at else None,
    )


async def exhibit() -> dict[str, object]:
    examples = {mode: asdict(await compare(mode, 12, 15000)) for mode in MODES}
    # Frozen independent cases. Hold the ledger shape fixed within each honest/fraud pair.
    rng = Random(250126)
    methods: dict[str, Counts] = {
        key: {"honest": 0, "fraud": 0, "false_pauses": 0, "caught": 0}
        for key in ("observed", "contextual")
    }
    honest_modes: tuple[Mode, ...] = ("valid", "valid", "expired", "future")
    for i in range(12):
        senders, payment = rng.randint(9, 16), rng.randint(60, 300) * 100
        cases: tuple[tuple[Mode, bool], ...] = (
            (honest_modes[i % 4], False),
            ("flagged" if i % 2 else "mismatch", True),
        )
        for mode, fraud in cases:
            result = await compare(mode, senders, payment)
            for key, score in (("observed", result.observed), ("contextual", result.contextual)):
                counts = methods[key]
                if fraud:
                    counts["fraud"] += 1
                    counts["caught"] += int(score.decision != "approved")
                else:
                    counts["honest"] += 1
                    counts["false_pauses"] += int(score.decision != "approved")
    return {
        "as_of": AS_OF.isoformat(),
        "issuer": JURY_CLEARING,
        "examples": examples,
        "test_seed": 250126,
        "cohort": methods,
    }


if __name__ == "__main__":
    OUTPUT.write_text(json.dumps(asyncio.run(exhibit()), indent=2) + "\n", encoding="utf-8")

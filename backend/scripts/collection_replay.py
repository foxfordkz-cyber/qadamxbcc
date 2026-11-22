"""Rebuild the two read-only website timelines with the production antifraud engine.

Run from backend: python -m scripts.collection_replay
"""

import asyncio
import json
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fakeredis import FakeAsyncRedis

from app.ml.model import MODEL_VERSION
from app.services.antifraud import AntifraudEngine, TransferContext
from app.services.graph import GraphStore

OUTPUT = Path(__file__).resolve().parents[2] / "frontend/src/lib/collection-checkpoints.json"
START = datetime(2026, 11, 20, 9, 0, tzinfo=UTC)
PAYMENT = 15_000
CHECKPOINTS = (0, 5, 11, 14)
LOCAL_ZONE = ZoneInfo("Asia/Almaty")


@dataclass(frozen=True)
class Signal:
    code: str
    kk: str
    ru: str


@dataclass(frozen=True)
class Snapshot:
    senders: int
    received: int
    forwarded: int
    score: int
    decision: str
    signals: list[Signal]


@dataclass(frozen=True)
class Checkpoint:
    time: str
    evaluated_at: str
    a: Snapshot
    b: Snapshot


@dataclass(frozen=True)
class Posting:
    tx_id: str
    occurred_at: str
    sender: str
    recipient: str
    amount: int


@dataclass(frozen=True)
class Replay:
    model: str
    payment: int
    checkpoints: list[Checkpoint]
    ledger: dict[str, list[Posting]]


async def history(forwards_funds: bool) -> tuple[list[Snapshot], list[Posting]]:
    """Each history starts empty. Only already posted events enter its projections."""
    async with FakeAsyncRedis() as redis:
        engine = AntifraudEngine(redis, GraphStore())
        base = TransferContext(
            tx_id="probe",
            sender_id="payer-0",
            recipient_id="recipient",
            device_id="device",
            amount=PAYMENT,
            sender_avg_amount=PAYMENT,
            occurred_at=START,
        )
        observations = []
        ledger = []
        for minute in range(CHECKPOINTS[-1] + 1):
            at = START + timedelta(minutes=minute)
            posting = None
            if minute < 12:
                posting = replace(
                    base, tx_id=f"in-{minute}", sender_id=f"payer-{minute}", occurred_at=at
                )
            elif minute == 14 and forwards_funds:
                posting = replace(
                    base,
                    tx_id="out",
                    sender_id="recipient",
                    recipient_id="next",
                    amount=150_000,
                    occurred_at=at,
                )
            if posting is not None:
                await engine.velocity.record_attempt(
                    tx_id=posting.tx_id,
                    sender_id=posting.sender_id,
                    recipient_id=posting.recipient_id,
                    amount=posting.amount,
                    ts=at.timestamp(),
                )
                await engine.record_settled(posting)
                engine.apply_transfer(posting)
                ledger.append(
                    Posting(
                        posting.tx_id,
                        posting.occurred_at.astimezone(LOCAL_ZONE).isoformat(),
                        posting.sender_id,
                        posting.recipient_id,
                        int(posting.amount),
                    )
                )
            if minute in CHECKPOINTS:
                # Evaluate the same prospective payment just after this checkpoint. It never
                # settles and contributes neither an attempt nor an edge to later checkpoints.
                risk = await engine.evaluate(
                    replace(base, occurred_at=at + timedelta(seconds=1)), record_attempt=False
                )
                graph = risk.recipient_graph
                observations.append(
                    Snapshot(
                        graph.in_degree,
                        int(graph.in_weight),
                        int(graph.out_weight),
                        risk.score,
                        risk.decision.value,
                        [Signal(r.code, r.reason_kk, r.reason_ru) for r in risk.reasons],
                    )
                )
        return observations, ledger


async def replay() -> Replay:
    a, a_ledger = await history(False)
    b, b_ledger = await history(True)
    checkpoints = []
    for i, minute in enumerate(CHECKPOINTS):
        evaluated_at = (START + timedelta(minutes=minute, seconds=1)).astimezone(LOCAL_ZONE)
        checkpoints.append(
            Checkpoint(evaluated_at.strftime("%H:%M"), evaluated_at.isoformat(), a[i], b[i])
        )
    return Replay(MODEL_VERSION, PAYMENT, checkpoints, {"a": a_ledger, "b": b_ledger})


if __name__ == "__main__":
    OUTPUT.write_text(
        json.dumps(asdict(asyncio.run(replay())), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

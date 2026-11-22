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
    a: Snapshot
    b: Snapshot


@dataclass(frozen=True)
class Replay:
    model: str
    payment: int
    checkpoints: list[Checkpoint]


async def history(forwards_funds: bool) -> list[Snapshot]:
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
        return observations


async def replay() -> Replay:
    a, b = await history(False), await history(True)
    local = ZoneInfo("Asia/Almaty")
    checkpoints = [
        Checkpoint((START + timedelta(minutes=m)).astimezone(local).strftime("%H:%M"), a[i], b[i])
        for i, m in enumerate(CHECKPOINTS)
    ]
    return Replay(MODEL_VERSION, PAYMENT, checkpoints)


if __name__ == "__main__":
    OUTPUT.write_text(
        json.dumps(asdict(asyncio.run(replay())), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

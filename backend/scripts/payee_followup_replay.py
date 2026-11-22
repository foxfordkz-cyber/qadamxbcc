"""Frozen paired holdout for marketplace deposits and urgent family requests.

The scenario numbers, labels, payment histories and call answers below were fixed
before running either policy. This uses the real engine, without requiring a DB.
"""

import asyncio
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta

from fakeredis import FakeAsyncRedis

from app.services.antifraud import AntifraudEngine, TransferContext
from app.services.graph import GraphStore


@dataclass(frozen=True)
class Arm:
    prior: int
    hours_ago: int
    requested: bool


@dataclass(frozen=True)
class Pair:
    name: str
    amount: int
    average: int
    fraud: Arm
    honest: Arm


# In each pair the honest arm is the corresponding real purchase or family transfer.
# A prior of zero means the customer has never paid this recipient. Some honest
# customers also report a call. "twin" arms have exactly the same observable evidence.
PAIRS = (
    Pair("market-reservation", 96_000, 28_000, Arm(1_200, 2, True), Arm(1_200, 2, False)),
    Pair("family-travel", 158_000, 41_000, Arm(500, 4, True), Arm(500, 240, True)),
    Pair("market-delivery", 122_000, 34_000, Arm(3_500, 6, True), Arm(3_500, 6, False)),
    Pair("family-rent-twin", 146_000, 36_000, Arm(2_000, 1, True), Arm(2_000, 1, True)),
    Pair("market-tools", 181_000, 51_000, Arm(7_000, 9, True), Arm(56_000, 9, True)),
    Pair("family-first", 85_000, 37_000, Arm(0, 0, True), Arm(0, 0, False)),
    Pair("market-first", 52_000, 31_000, Arm(0, 0, True), Arm(0, 0, False)),
    Pair("family-unreported-twin", 99_000, 30_000, Arm(900, 5, False), Arm(900, 5, False)),
    Pair("market-no-call-twin", 46_000, 27_000, Arm(0, 0, False), Arm(0, 0, False)),
    Pair("family-small-twin", 33_000, 24_000, Arm(1_000, 2, True), Arm(1_000, 2, True)),
    Pair("market-old-payee", 111_000, 32_000, Arm(4_000, 72, True), Arm(4_000, 720, True)),
    Pair("family-gift", 208_000, 62_000, Arm(2_500, 15, True), Arm(2_500, 15, False)),
)


async def replay() -> list[tuple[str, bool, str, int]]:
    redis = FakeAsyncRedis()
    try:
        engine = AntifraudEngine(redis, GraphStore())
        rows = []
        for pair in PAIRS:
            for is_fraud, arm in ((True, pair.fraud), (False, pair.honest)):
                key = f"{pair.name}-{int(is_fraud)}"
                payment = TransferContext(
                    tx_id=key,
                    sender_id=f"payer-{key}",
                    recipient_id=f"payee-{key}",
                    device_id=f"device-{key}",
                    occurred_at=datetime(2026, 11, 21, 8, tzinfo=UTC),
                    amount=pair.amount,
                    sender_avg_amount=pair.average,
                    payment_requested_after_call=arm.requested,
                )
                if arm.prior:
                    settled = replace(
                        payment,
                        tx_id=f"settled-{key}",
                        amount=arm.prior,
                        occurred_at=payment.occurred_at - timedelta(hours=arm.hours_ago),
                        payment_requested_after_call=False,
                    )
                    await engine.record_settled(settled)
                    engine.apply_transfer(settled)
                result = await engine.evaluate(payment)
                rows.append((pair.name, is_fraud, result.decision.value, result.score))
        return rows
    finally:
        await redis.aclose()


if __name__ == "__main__":
    for row in asyncio.run(replay()):
        print(*row)

import json
from datetime import datetime
from pathlib import Path

import fakeredis
import pytest

from app.services.antifraud import AntifraudEngine, TransferContext
from app.services.graph import GraphStore

FIXTURE = Path(__file__).resolve().parents[2] / "frontend/src/lib/demo-decision-contract.json"
CONTRACT = json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("index", range(len(CONTRACT["cases"])))
async def test_offline_contract_with_real_scorer(index: int) -> None:
    row = CONTRACT["cases"][index]
    when = datetime.fromisoformat(CONTRACT["timestamp"])
    graph = GraphStore()
    sender, recipient = CONTRACT["sender_id"], row["recipient_id"]
    graph.add_transfer(sender, CONTRACT["familiar_recipient"], 25000)
    redis = fakeredis.FakeAsyncRedis()
    try:
        engine = AntifraudEngine(redis, graph)
        for net in CONTRACT["networks"]:
            target = net["account"]
            graph.add_account(target, device_id="shared")
            for n in range(net["device_peers"]):
                graph.add_account(f"other-{n}", device_id="shared")
            for n in range(net["senders"]):
                graph.add_transfer(f"payer-{n}", target, net["incoming_each"])
                await engine.velocity.record_attempt(
                    tx_id=f"prior-{n}",
                    sender_id=f"payer-{n}",
                    recipient_id=target,
                    amount=net["incoming_each"],
                    ts=when.timestamp() - n - 1,
                )
            graph.add_transfer(
                target, "out", net["senders"] * net["incoming_each"] * net["transit_ratio"]
            )
        result = await engine.evaluate(
            TransferContext(
                tx_id="contract",
                sender_id=sender,
                recipient_id=recipient,
                amount=float(row["amount"]),
                device_id="sender-device",
                occurred_at=when,
                sender_avg_amount=CONTRACT["sender_mean"],
                **row["context"],
            )
        )
        assert (result.decision.value, result.score, sorted(r.code for r in result.reasons)) == (
            row["status"],
            row["score"],
            row["codes"],
        )
    finally:
        await redis.aclose()

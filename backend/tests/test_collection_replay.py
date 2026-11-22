"""The public comparison must follow the same engine as the private SOC."""

import json
from dataclasses import asdict

from scripts.collection_replay import OUTPUT, replay


async def test_published_decisions_use_only_history_visible_at_each_checkpoint() -> None:
    result = await replay()
    assert asdict(result) == json.loads(OUTPUT.read_text(encoding="utf-8"))
    assert [c.a.senders for c in result.checkpoints] == [1, 6, 12, 12]
    for checkpoint in result.checkpoints:
        assert (
            checkpoint.a.received == checkpoint.b.received == checkpoint.a.senders * result.payment
        )
        assert checkpoint.a.decision == "approved"
        assert checkpoint.a.forwarded == 0
    assert all(c.a == c.b for c in result.checkpoints[:-1])
    final = result.checkpoints[-1]
    assert final.b.forwarded == 150_000
    assert final.b.decision == "blocked"
    assert {s.code for s in final.b.signals} >= {"RECIPIENT_TRANSIT_RATIO"}
    assert "RECIPIENT_TRANSIT_RATIO" not in {s.code for s in final.a.signals}

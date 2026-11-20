"""Scenario acceptance gates and provenance of the SOC scorecard."""

import json
from dataclasses import asdict

from scripts.scenario_stand import (
    OLD_HONEST_HOLDS,
    OLD_MISSES,
    ROOT,
    call_comparisons,
    call_scorecard,
    replay,
    report,
    stopped,
    summary,
)


async def test_balanced_scenario_stand_and_published_evidence() -> None:
    cases = await replay()
    calls = await call_comparisons()
    assert len({r.id for r in cases}) == len(cases) == 120
    assert sum(r.fraud for r in cases) == 60
    assert sum(r.fraud and stopped(r) for r in cases) >= 57
    assert {r.id for r in cases if not r.fraud and stopped(r)} <= OLD_HONEST_HOLDS
    assert not any(not r.fraud and r.decision == "blocked" for r in cases)
    keyed = {r.id: r for r in cases}
    for key in OLD_MISSES:
        pair = calls[key]
        assert pair.ordinary == keyed[key]
        assert "POST_CALL_PAYMENT_REQUEST" not in pair.ordinary.signals
        assert pair.reported.decision == "cooling_off"
        assert "POST_CALL_PAYMENT_REQUEST" in pair.reported.signals
    assert calls["relative-05"].ordinary.decision == "cooling_off"
    assert "NEW_PAYEE_NIGHT_SPIKE" in calls["relative-05"].ordinary.signals
    for key in ("family-01", "seller-01"):
        assert calls[key].ordinary.decision == calls[key].reported.decision == "approved"
    assert calls["friend-02"].ordinary.decision == "approved"
    assert calls["friend-02"].reported.decision == "cooling_off"
    twin = calls["honest-twin"]
    assert not twin.ordinary.fraud
    assert twin.ordinary.score == calls["relative-05"].ordinary.score
    assert twin.ordinary.decision == calls["relative-05"].ordinary.decision
    assert json.loads((ROOT / "docs/evidence/scenario_stand.json").read_text(encoding="utf-8")) == [
        asdict(r) for r in cases
    ]
    assert (ROOT / "docs/SCENARIO_STAND.md").read_text(encoding="utf-8") == report(cases, calls)
    assert json.loads(
        (ROOT / "frontend/src/lib/scenario-summary.json").read_text(encoding="utf-8")
    ) == summary(cases)
    assert json.loads(
        (ROOT / "frontend/src/lib/post-call-replay.json").read_text(encoding="utf-8")
    ) == call_scorecard(calls)

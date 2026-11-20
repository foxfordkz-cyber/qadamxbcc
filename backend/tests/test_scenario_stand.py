"""Scenario acceptance gates and provenance of the SOC scorecard."""

import json
from dataclasses import asdict

from scripts.scenario_stand import ROOT, replay, report, stopped, summary


async def test_balanced_scenario_stand_and_published_evidence() -> None:
    cases = await replay()
    assert len({r.id for r in cases}) == len(cases) == 120
    assert sum(r.fraud for r in cases) == 60
    assert sum(r.fraud and stopped(r) for r in cases) >= 54
    assert sum(not r.fraud and stopped(r) for r in cases) <= 9
    assert not any(not r.fraud and r.decision == "blocked" for r in cases)
    assert json.loads((ROOT / "docs/evidence/scenario_stand.json").read_text(encoding="utf-8")) == [
        asdict(r) for r in cases
    ]
    assert (ROOT / "docs/SCENARIO_STAND.md").read_text(encoding="utf-8") == report(cases)
    assert json.loads(
        (ROOT / "frontend/src/lib/scenario-summary.json").read_text(encoding="utf-8")
    ) == summary(cases)

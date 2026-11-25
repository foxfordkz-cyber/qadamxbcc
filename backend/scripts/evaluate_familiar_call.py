"""Paired engine decisions on locked synthetic transfer cohorts. Reads frozen weights only."""

import argparse
import asyncio
import hashlib
import json
import math
import random
import time
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any

from app.ml.familiar import ARTIFACT, VERSION, FamiliarRouter, familiar_router
from app.ml.features import Features
from app.ml.model import MODEL_VERSION, RiskScorer, get_model
from app.ml.training import routine_population
from app.services.antifraud import COOLING_OFF_THRESHOLD
from scripts.compare_phone_coercion import assisted_cases
from scripts.evaluate_fraud_model import Scenario, evaluate_scenario, scenarios, serving_features

REPORT = Path(__file__).resolve().parents[2] / "frontend/src/lib/familiar-call-trial.json"


@dataclass
class Counts:
    caught: int = 0
    missed: int = 0
    false_pauses: int = 0
    honest_approved: int = 0

    def add(self, fraud: bool, held: bool) -> None:
        if fraud:
            self.caught += held
            self.missed += not held
        else:
            self.false_pauses += held
            self.honest_approved += not held


def cohort(
    seed: int, size: int, extra_missing: bool, *, cumulative_pauses: bool = True
) -> list[tuple[str, Scenario]]:
    cases = assisted_cases(seed, size, cumulative_pauses=cumulative_pauses)
    if not extra_missing:
        return cases
    # Drop a further quarter of sensor sessions independently of their labels.
    # Matched twins share a sensor observation, so mask the pair together.
    rng = random.Random(seed + 1)
    masked = {}
    result = []
    for group, case in cases:
        ctx = case.context
        if ctx not in masked:
            masked[ctx] = rng.random() < 0.25
        if masked[ctx]:
            case = replace(
                case,
                context=replace(
                    ctx,
                    recipient_input_length=None,
                    typing_duration_ms=None,
                    hesitation_count=0,
                    hesitation_ms=None,
                ),
            )
        result.append((group, case))
    return result


async def compare(
    cases: list[tuple[str, Scenario]], baseline: RiskScorer, candidate: FamiliarRouter
) -> dict[str, Any]:
    old_counts, new_counts = Counts(), Counts()
    groups: dict[str, tuple[Counts, Counts]] = {}
    specialist = fallback_changes = hard_blocks_added = 0
    for group, case in cases:
        old = await evaluate_scenario(case, "full_hybrid", baseline, include_version=True)
        new = await evaluate_scenario(case, "full_hybrid", candidate, include_version=True)
        old_hold, new_hold = old["status"] != "approved", new["status"] != "approved"
        old_counts.add(case.fraudulent, old_hold)
        new_counts.add(case.fraudulent, new_hold)
        group_old, group_new = groups.setdefault(group, (Counts(), Counts()))
        group_old.add(case.fraudulent, old_hold)
        group_new.add(case.fraudulent, new_hold)
        specialist += new["model_version"] == VERSION
        fallback_changes += new["model_version"] != VERSION and old != new
        hard_blocks_added += new["status"] == "blocked" and old["status"] != "blocked"
    return {
        "size": len(cases),
        "specialist": specialist,
        "fallback_changes": fallback_changes,
        "hard_blocks_added": hard_blocks_added,
        "baseline": asdict(old_counts),
        "candidate": asdict(new_counts),
        "groups": {
            group: {"baseline": asdict(a), "candidate": asdict(b)}
            for group, (a, b) in groups.items()
        },
    }


def p95_ms(model: RiskScorer, samples: list[Features]) -> float:
    elapsed = []
    for n in range(2200):
        start = time.perf_counter_ns()
        model.score(samples[n % len(samples)])
        if n >= 200:
            elapsed.append((time.perf_counter_ns() - start) / 1e6)
    return round(sorted(elapsed)[math.ceil(0.95 * len(elapsed)) - 1], 5)


async def run() -> dict[str, Any]:
    baseline = get_model()
    candidate = familiar_router(baseline)
    sets = {}
    for name, seed, size, missing in [
        ("historical", 20261217, 128, False),
        ("fresh", 72491, 256, False),
        ("missing", 78157, 128, True),
    ]:
        cases = cohort(seed, size, missing, cumulative_pauses=name != "historical")
        sets[name] = await compare(cases, baseline, candidate)
        sets[name]["seed"] = seed
    x, _ = routine_population(10000, 49681)
    ordinary = [f for row in x if not (f := serving_features(row)).active_call]
    changes = sum(candidate.score(f) != baseline.score(f) for f in ordinary)
    controls = await compare([("panel", case) for case in scenarios()], baseline, candidate)
    # An illustrative receipt, outside all benchmark counts. The same engine
    # creates the public walkthrough and the transfer in the local SOC.
    example = scenarios()[0]
    example = replace(
        example,
        context=replace(
            example.context,
            amount=42310.25,
            active_call=True,
            recipient_input_length=12,
            typing_duration_ms=48000,
            hesitation_ms=9500,
            hesitation_count=4,
        ),
    )
    original = await evaluate_scenario(example, "full_hybrid", baseline)
    observed = await evaluate_scenario(
        example, "full_hybrid", candidate, include_version=True, include_contributors=True
    )
    if observed["model_version"] != VERSION:
        raise ValueError("Illustrative receipt did not exercise the specialist")
    latency = {
        "specialist": p95_ms(
            candidate,
            [
                Features(
                    active_call=True,
                    amount_ratio=i / 4 + 1,
                    typing_speed_cps=5 / i,
                    hesitation_ms=i * 173,
                    hesitation_count=i % 8,
                )
                for i in range(1, 41)
            ],
        ),
        "fallback": p95_ms(candidate, ordinary[:200]),
    }
    passed = (
        all(
            sets[k]["candidate"]["caught"] >= sets[k]["baseline"]["caught"]
            and sets[k]["candidate"]["false_pauses"] < sets[k]["baseline"]["false_pauses"]
            for k in ("fresh", "missing")
        )
        and all(
            s["fallback_changes"] == s["hard_blocks_added"] == 0 for s in [*sets.values(), controls]
        )
        and changes == 0
        and max(latency.values()) < 2
    )
    return {
        "baseline_version": MODEL_VERSION,
        "candidate_version": VERSION,
        "artifact_sha256": hashlib.sha256(await asyncio.to_thread(ARTIFACT.read_bytes)).hexdigest(),
        "training_sessions": 18000,
        "threshold": candidate.expert.threshold,
        "synthetic_gate_passed": passed,
        "serving_mode": "observation",
        "cohorts": sets,
        "controls": controls,
        "no_call_controls": {"size": len(ordinary), "changed_predictions": changes},
        "model_p95_ms": latency,
        "example": {
            "amount": example.context.amount,
            "incumbent_score": original["ml_score"],
            "incumbent_risk": original["risk_score"],
            "ml_uplift": original["ml_uplift"],
            "pause_floor": COOLING_OFF_THRESHOLD,
            "incumbent_status": original["status"],
            "candidate_score": observed["ml_score"],
            "candidate_suggests_review": observed["ml_score"] >= candidate.expert.threshold,
            "contributors": observed["contributors"],
        },
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=REPORT)
    args = parser.parse_args()
    result = asyncio.run(run())
    args.output.write_bytes((json.dumps(result, indent=2) + "\n").encode())
    print(json.dumps({k: result[k] for k in ("synthetic_gate_passed", "model_p95_ms")}))

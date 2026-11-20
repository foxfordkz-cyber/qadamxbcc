"""Paired v2/v3 validation on ordinary traffic and a separate assisted-transfer stress set."""

import argparse
import asyncio
import hashlib
import json
import random
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any

import joblib
import sklearn

from app.ml.features import FEATURE_NAMES
from app.ml.model import MODEL_PATH, MODEL_VERSION, FraudModel, load_model
from app.ml.training import routine_population
from scripts.evaluate_fraud_model import (
    Scenario,
    binary_metrics,
    evaluate_scenario,
    scenarios,
    serving_features,
)


def assisted_cases(seed: int, per_group: int = 128) -> list[tuple[str, Scenario]]:
    """Fixed-purpose challenge, independent of the numpy training generator.

    Each observation is a known payee on the usual device during a call. There
    is no paste/deposit flag or graph evidence. Legitimate cases include large
    payments, slow entry, and a matched group with exactly the fraud inputs.
    """
    rng = random.Random(seed)
    base = scenarios()[0]
    result = []
    for group in ("dictated", "careful_legitimate", "everyday_call", "ambiguous_pair"):
        for _ in range(per_group):
            if group in {"dictated", "ambiguous_pair"}:
                pauses = rng.randint(2, 7)
                gap = rng.randint(4500, 19000)
                ratio = rng.uniform(1.8, 7.5)
            elif group == "careful_legitimate":
                pauses = rng.randint(0, 3)
                gap = rng.randint(1500, 12500)
                ratio = rng.uniform(1.5, 8)
            else:
                pauses = rng.randint(0, 2)
                gap = rng.randint(500, 3500)
                ratio = rng.uniform(0.2, 3.8)
            longest = gap if pauses else 0
            duration = rng.randint(2000, 12500) + longest
            duration += sum(rng.randint(0, gap) for _ in range(max(0, pauses - 1)))
            missing = rng.random() < 0.20
            ctx = replace(
                base.context,
                amount=round(base.context.sender_avg_amount * ratio),
                active_call=True,
                recipient_input_length=None if missing else 12,
                typing_duration_ms=None if missing else duration,
                hesitation_count=0 if missing else pauses,
                hesitation_ms=None if missing else longest,
            )
            labels = (True, False) if group == "ambiguous_pair" else (group == "dictated",)
            for label in labels:
                case = replace(base, context=ctx, fraudulent=label)
                result.append((group, case))
    return result


async def compare(baseline: Path, seed: int) -> dict[str, Any]:
    # Only accept an explicitly supplied, trusted local binary: joblib uses pickle.
    artifact = await asyncio.to_thread(joblib.load, baseline)
    if (
        artifact.get("model_version") != "bcc-synthetic-rf-v2"
        or artifact.get("feature_names") != FEATURE_NAMES
        or artifact.get("sklearn_version") != sklearn.__version__
    ):
        raise ValueError("Expected a trusted compatible v2 artifact")
    current = load_model(MODEL_PATH, allow_training=False)
    shared_x, shared_y = routine_population(10_000, seed)
    routine = [serving_features(row) for row in shared_x]
    labels = shared_y.tolist()
    workflows = assisted_cases(seed)
    models = (
        (artifact["model_version"], FraudModel(artifact["estimator"]), baseline),
        (MODEL_VERSION, current, MODEL_PATH),
    )
    report: dict[str, Any] = {
        "seed": seed,
        "sklearn": sklearn.__version__,
        "scope": "Synthetic labels. Raw model cutoff 50. Actual engine intervention cutoff 40.",
        "limitations": (
            "Stress cohorts deliberately enrich for assisted calls and matched ambiguous pairs. "
            "Their frequencies are not customer prevalence. No inference about bank accuracy."
        ),
        "models": {},
    }
    baseline_scores: list[float] = []
    for version, model, path in models:
        raw = [model.score(row).score for row in routine]
        if not baseline_scores:
            baseline_scores = raw
        else:
            no_call = [i for i, sample in enumerate(routine) if not sample.active_call]
            report["no_call_regression"] = {
                "sample_count": len(no_call),
                "changed_scores": sum(raw[i] != baseline_scores[i] for i in no_call),
            }
        outcomes = [
            (group, case.fraudulent, (await evaluate_scenario(case, "full_hybrid", model)))
            for group, case in workflows
        ]
        groups: dict[str, Any] = {}
        for group in ["all", *sorted({group for group, _, _ in outcomes})]:
            subset = [row for row in outcomes if group == "all" or row[0] == group]
            groups[group] = asdict(
                binary_metrics(
                    [int(label) for _, label, _ in subset],
                    [obs["risk_score"] for _, _, obs in subset],
                    40,
                )
            )
        report["models"][version] = {
            "sha256": hashlib.sha256(await asyncio.to_thread(path.read_bytes)).hexdigest(),
            "previous_generator_model_only": asdict(binary_metrics(labels, raw, 50)),
            "assisted_workflows_full_engine": groups,
            "hard_blocks_in_assisted_workflows": sum(
                obs["status"] == "blocked" for _, _, obs in outcomes
            ),
        }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-artifact", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20261217)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = asyncio.run(compare(args.baseline_artifact, args.seed))
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

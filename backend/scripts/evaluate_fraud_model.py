"""Reproducible synthetic evidence, never a claim about real bank fraud accuracy.

From backend: uv run python -m scripts.evaluate_fraud_model --output
../.local-checks/model-evaluation.json

Loads the existing artifact without training. Population metrics use independent
random draws from the same synthetic generator; this is NOT a temporal holdout.
The separately declared scenario panel exercises the real engine on isolated
fakeredis instances. Its selected cases are acceptance examples, not prevalence.
"""

import argparse
import asyncio
import hashlib
import json
import math
from collections.abc import Sequence
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime, timedelta
from itertools import product
from pathlib import Path
from typing import Any, Literal
from unittest.mock import patch

import fakeredis

from app.ml.features import FEATURE_NAMES, Features
from app.ml.model import (
    GENERATOR_VERSION,
    MODEL_PATH,
    MODEL_VERSION,
    FraudModel,
    Prediction,
    RiskScorer,
    load_model,
)
from app.ml.training import FROZEN_EVALUATION_ROWS, FROZEN_EVALUATION_SEED, SEED, synthetic_data
from app.services.antifraud import AntifraudEngine, TransferContext, decide
from app.services.graph import GraphStore

EVALUATION_SEED = 20261117
SCENARIO_TIME = datetime(2026, 11, 17, 9, 0, tzinfo=UTC)
Variant = Literal["full_hybrid", "without_ml", "without_browser_biometrics"]


def _rate(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def _wilson(successes: int, total: int) -> list[float] | None:
    """Approximate 95% binomial interval for this simulation sample only."""
    if not total:
        return None
    z = 1.959963984540054
    rate = successes / total
    scale = 1 + z * z / total
    center = (rate + z * z / (2 * total)) / scale
    margin = z * math.sqrt(rate * (1 - rate) / total + z * z / (4 * total * total)) / scale
    return [max(0.0, center - margin), min(1.0, center + margin)]


@dataclass(frozen=True, slots=True)
class BinaryMetrics:
    threshold: float
    sample_count: int
    positives: int
    negatives: int
    tp: int
    fp: int
    fn: int
    tn: int
    precision: float | None
    recall: float | None
    false_positive_rate: float | None
    false_negative_rate: float | None
    alert_rate: float
    false_positive_rate_interval_95: list[float] | None


def binary_metrics(
    labels: Sequence[int], scores: Sequence[float], threshold: float
) -> BinaryMetrics:
    if (
        not labels
        or len(labels) != len(scores)
        or not math.isfinite(threshold)
        or not 0 <= threshold <= 100
        or any(label not in (0, 1) for label in labels)
        or any(not math.isfinite(score) or not 0 <= score <= 100 for score in scores)
    ):
        raise ValueError("Expected aligned nonempty binary labels and finite 0-100 scores")
    tp = fp = fn = tn = 0
    for label, score in zip(labels, scores, strict=True):
        if score >= threshold:
            if label:
                tp += 1
            else:
                fp += 1
        elif label:
            fn += 1
        else:
            tn += 1
    return BinaryMetrics(
        threshold=threshold,
        sample_count=len(labels),
        positives=tp + fn,
        negatives=fp + tn,
        tp=tp,
        fp=fp,
        fn=fn,
        tn=tn,
        precision=_rate(tp, tp + fp),
        recall=_rate(tp, tp + fn),
        false_positive_rate=_rate(fp, fp + tn),
        false_negative_rate=_rate(fn, fn + tp),
        alert_rate=(tp + fp) / len(labels),
        false_positive_rate_interval_95=_wilson(fp, fp + tn),
    )


def serving_features(row: Sequence[float]) -> Features:
    """Use the actual serving contract, including integer browser pause durations."""
    return Features(
        amount_ratio=float(row[0]),
        night_hour=bool(row[1]),
        new_recipient=bool(row[2]),
        active_call=bool(row[3]),
        deposit_withdrawal=bool(row[4]),
        fan_in_velocity=int(row[5]),
        transit_ratio=float(row[6]),
        paste_detected=bool(row[7]),
        typing_speed_cps=float(row[8]),
        hesitation_ms=int(row[9]),
        hesitation_count=int(row[10]),
        new_device=bool(row[11]),
    )


@dataclass(frozen=True, slots=True)
class Scenario:
    id: str
    title_ru: str
    title_kk: str
    fraudulent: bool
    expected_status: str
    context: TransferContext
    known_recipient: bool = True
    shared_tablet: bool = False
    collection: bool = False
    cashout: bool = False


def scenarios() -> tuple[Scenario, ...]:
    base = TransferContext(
        tx_id="candidate",
        sender_id="payer",
        recipient_id="recipient",
        amount=25_000,
        sender_avg_amount=40_000,
        device_id="payer-phone",
        occurred_at=SCENARIO_TIME,
    )
    coercion = replace(
        base,
        amount=900_000,
        active_call=True,
        from_deposit=True,
        pasted_recipient=True,
        typing_duration_ms=20_000,
        recipient_input_length=12,
        hesitation_ms=16_000,
        hesitation_count=5,
    )
    return (
        Scenario(
            "ordinary_p2p",
            "Обычный знакомый получатель",
            "Таныс алушыға аударым",
            False,
            "approved",
            base,
        ),
        Scenario(
            "paste_without_pressure",
            "Вставка реквизитов без давления",
            "Қысымсыз реквизиттерді қою",
            False,
            "approved",
            replace(
                base,
                pasted_recipient=True,
                typing_duration_ms=3000,
                recipient_input_length=12,
                hesitation_ms=0,
            ),
        ),
        Scenario(
            "benign_call",
            "Обычный звонок во время перевода",
            "Аударым кезіндегі әдеттегі қоңырау",
            False,
            "approved",
            replace(base, active_call=True),
        ),
        # This fixture represents an already validated server-side SQL anchor.
        # It evaluates the policy floor, not SQL discovery/concurrency (API tests
        # cover those). Identical observations can still have a legitimate purpose.
        *(
            Scenario(
                identity,
                title_ru,
                title_kk,
                fraudulent,
                "cooling_off",
                replace(
                    base,
                    active_hold_id="original-server-hold",
                    active_hold_until=SCENARIO_TIME + timedelta(minutes=5),
                    active_hold_recipient_changed=True,
                ),
                known_recipient=False,
            )
            for identity, title_ru, title_kk, fraudulent in (
                (
                    "active_hold_recipient_substitution",
                    "Смена получателя во время серверной проверки",
                    "Серверлік тексеру кезінде алушыны ауыстыру",
                    True,
                ),
                (
                    "legitimate_retry_during_review",
                    "Честный новый перевод во время той же проверки",
                    "Сол тексеру кезіндегі заңды жаңа аударым",
                    False,
                ),
            )
        ),
        Scenario(
            "family_tablet",
            "Общий семейный планшет",
            "Ортақ отбасылық планшет",
            False,
            "approved",
            base,
            shared_tablet=True,
        ),
        Scenario(
            "birthday_collection",
            "Сбор с 12 отправителей без вывода",
            "12 жіберушіден жиналған қаражат, шығару жоқ",
            False,
            "approved",
            base,
            known_recipient=False,
            collection=True,
        ),
        # The same observations can have a legitimate purpose. A hold is friction,
        # not proof of fraud; retain this false alert instead of selecting it away.
        Scenario(
            "legitimate_but_ambiguous",
            "Законный перевод с теми же тревожными сигналами",
            "Дәл сондай қауіп белгілері бар заңды аударым",
            False,
            "cooling_off",
            coercion,
            known_recipient=False,
        ),
        Scenario(
            "phone_coercion",
            "Телефонное принуждение и вывод депозита",
            "Телефон қысымы және депозиттен алу",
            True,
            "cooling_off",
            coercion,
            known_recipient=False,
        ),
        Scenario(
            "subtle_coercion",
            "Звонок, рост суммы и длительные паузы",
            "Қоңырау, соманың өсуі және ұзақ кідірістер",
            True,
            "cooling_off",
            replace(
                base,
                amount=160_000,
                active_call=True,
                typing_duration_ms=30_000,
                recipient_input_length=12,
                hesitation_ms=25_000,
                hesitation_count=5,
            ),
        ),
        Scenario(
            "takeover_context",
            "Ночь и новое устройство",
            "Түн және жаңа құрылғы",
            True,
            "cooling_off",
            replace(
                base,
                amount=400_000,
                is_new_device=True,
                occurred_at=SCENARIO_TIME - timedelta(hours=11),
            ),
            known_recipient=False,
        ),
        Scenario(
            "transit_drop_hub",
            "12 входящих и подтверждённый быстрый транзит",
            "12 кіріс және расталған жылдам транзит",
            True,
            "blocked",
            base,
            known_recipient=False,
            shared_tablet=True,
            collection=True,
            cashout=True,
        ),
    )


async def evaluate_scenario(
    scenario: Scenario,
    variant: Variant,
    model: RiskScorer | None = None,
    *,
    include_version: bool = False,
    include_contributors: bool = False,
) -> dict[str, Any]:
    redis = fakeredis.FakeAsyncRedis()
    graph = GraphStore()
    graph.add_account("payer", device_id="payer-phone")
    graph.add_account("recipient", device_id="recipient-tablet")
    if scenario.known_recipient:
        graph.add_transfer("payer", "recipient", 25_000)
    if scenario.shared_tablet:
        for account in ("family-1", "family-2"):
            graph.add_account(account, device_id="recipient-tablet")
    engine = AntifraudEngine(redis, graph, allow_model_training=False)
    if model is not None:
        engine.model = model
    try:
        if scenario.collection:
            for index in range(12):
                prior = replace(
                    scenario.context,
                    tx_id=f"incoming-{index}",
                    sender_id=f"guest-{index}",
                    amount=100_000,
                    occurred_at=SCENARIO_TIME - timedelta(minutes=5),
                )
                await engine.velocity.record_attempt(
                    tx_id=prior.tx_id,
                    sender_id=prior.sender_id,
                    recipient_id=prior.recipient_id,
                    amount=prior.amount,
                    ts=prior.occurred_at.timestamp(),
                )
                await engine.record_settled(prior)
                engine.apply_transfer(prior)
        if scenario.cashout:
            prior = replace(
                scenario.context,
                tx_id="cashout",
                sender_id="recipient",
                recipient_id="cashout-account",
                amount=1_100_000,
                occurred_at=SCENARIO_TIME - timedelta(minutes=2),
            )
            await engine.record_settled(prior)
            engine.apply_transfer(prior)
        ctx = scenario.context
        if variant == "without_browser_biometrics":
            ctx = replace(
                ctx,
                pasted_recipient=False,
                typing_duration_ms=None,
                recipient_input_length=None,
                hesitation_ms=None,
                hesitation_count=0,
            )
        if variant == "without_ml":
            # Exact existing rules/graph policy, with the residual ML uplift disabled.
            # This patch lives only in this isolated evaluation process and is restored.
            with patch.object(engine.model, "score", return_value=Prediction(0, 0, ())):
                evaluation = await engine.evaluate(ctx)
        else:
            evaluation = await engine.evaluate(ctx)
        return {
            "status": evaluation.decision.value,
            **({"model_version": evaluation.ml_model_version} if include_version else {}),
            **(
                {"contributors": [asdict(c) for c in evaluation.ml_contributors]}
                if include_contributors
                else {}
            ),
            "risk_score": evaluation.score,
            "ml_score": evaluation.ml_score if variant != "without_ml" else None,
            "reason_codes": [reason.code for reason in evaluation.reasons],
            "ml_uplift": sum(
                reason.score_delta
                for reason in evaluation.reasons
                if reason.code == "ML_RISK_UPLIFT"
            ),
            "matches_expected": evaluation.decision.value == scenario.expected_status,
        }
    finally:
        await redis.aclose()


async def scenario_panel(model: FraudModel | None = None) -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    variants: tuple[Variant, ...] = ("full_hybrid", "without_ml", "without_browser_biometrics")
    for scenario in scenarios():
        cases.append(
            {
                "id": scenario.id,
                "title_ru": scenario.title_ru,
                "title_kk": scenario.title_kk,
                "synthetic_fraud_label": int(scenario.fraudulent),
                "expected_full_hybrid_status": scenario.expected_status,
                "variants": {
                    variant: await evaluate_scenario(scenario, variant, model)
                    for variant in variants
                },
            }
        )
    labels = [int(case["synthetic_fraud_label"]) for case in cases]
    summaries = {}
    for variant in variants:
        scores = [float(case["variants"][variant]["risk_score"]) for case in cases]
        summaries[variant] = {
            "intervention_at_40": asdict(binary_metrics(labels, scores, 40)),
            "hard_block_at_75": asdict(binary_metrics(labels, scores, 75)),
            "expected_policy_matches": sum(
                case["variants"][variant]["matches_expected"] for case in cases
            ),
        }
    return {"case_count": len(cases), "cases": cases, "summaries": summaries}


async def decision_sensitivity_grid(model: FraudModel) -> dict[str, Any]:
    """Predeclared factorial, without fraud labels. It measures mechanism, not accuracy."""
    transitions: dict[str, int] = {}
    examples: list[dict[str, Any]] = []
    base = scenarios()[0]
    count = 0
    for ratio, call, new, paste, slow, night, device in product(
        (1, 4, 12),
        (False, True),
        (False, True),
        (False, True),
        (False, True),
        (False, True),
        (False, True),
    ):
        context = replace(
            base.context,
            amount=40_000 * ratio,
            active_call=call,
            pasted_recipient=paste,
            is_new_device=device,
            typing_duration_ms=30_000 if slow else None,
            recipient_input_length=12 if slow else None,
            hesitation_ms=25_000 if slow else None,
            hesitation_count=5 if slow else 0,
            occurred_at=SCENARIO_TIME - timedelta(hours=11) if night else SCENARIO_TIME,
        )
        scenario = replace(base, context=context, known_recipient=not new)
        full = await evaluate_scenario(scenario, "full_hybrid", model)
        # Uplift is additive after the existing policy floor. Subtract the actual
        # persisted reason delta to compare on precisely the same graph/history.
        floor = int(full["risk_score"]) - int(full["ml_uplift"])
        transition = f"{decide(floor).value}->{full['status']}"
        transitions[transition] = transitions.get(transition, 0) + 1
        count += 1
        if transition == "approved->cooling_off" and len(examples) < 3:
            examples.append(
                {
                    "amount_ratio": ratio,
                    "active_call": call,
                    "new_recipient": new,
                    "pasted_recipient": paste,
                    "slow_typing_and_pauses": slow,
                    "night_hour": night,
                    "new_device": device,
                    "rules_graph_biometric_floor": floor,
                    "hybrid_score": full["risk_score"],
                    "ml_score": full["ml_score"],
                    "ml_uplift": full["ml_uplift"],
                    "reason_codes": full["reason_codes"],
                }
            )
    return {
        "case_count": count,
        "has_ground_truth_labels": False,
        "scope": "Fixed Cartesian grid of context flags; no settled recipient network",
        "dimensions": {
            "amount_ratio": [1, 4, 12],
            "binary": ["call", "new_recipient", "paste", "slow_cadence", "night", "new_device"],
        },
        "transitions_from_without_ml_to_hybrid": transitions,
        "illustrative_approved_to_hold_examples": examples,
        "interpretation": "Decision changes demonstrate ML influence, NOT fraud recall improvement",
    }


async def evaluate_artifact(
    *,
    rows: int = 10_000,
    seed: int = EVALUATION_SEED,
    baseline_artifact: Path | None = None,
) -> dict[str, Any]:
    # app.ml has set numerical thread limits before importing numpy/sklearn.
    import joblib
    import numpy as np
    import sklearn
    from sklearn.metrics import brier_score_loss, roc_auc_score

    if not 100 <= rows <= 100_000 or seed == SEED or not 0 <= seed < 2**32:
        raise ValueError("Use 100-100000 rows and an independent uint32 seed")
    model: FraudModel = load_model(MODEL_PATH, allow_training=False)
    artifact_bytes = await asyncio.to_thread(MODEL_PATH.read_bytes)
    x, y = synthetic_data(rows, seed=seed)
    feature_rows = [serving_features(row) for row in x]
    scores = [model.score(features).score for features in feature_rows]
    missing_browser_scores = [
        model.score(
            replace(
                features,
                paste_detected=False,
                typing_speed_cps=-1,
                hesitation_ms=-1,
                hesitation_count=0,
            )
        ).score
        for features in feature_rows
    ]
    labels = [int(value) for value in y]
    probabilities = np.asarray(scores) / 100
    baseline_report: dict[str, Any] | None = None
    if baseline_artifact is not None:
        # Only explicitly selected trusted local artifacts. joblib uses pickle.
        artifact = await asyncio.to_thread(joblib.load, baseline_artifact)
        if (
            not isinstance(artifact, dict)
            or artifact.get("model_version") != "bcc-synthetic-rf-v1"
            or artifact.get("sklearn_version") != sklearn.__version__
            or artifact.get("feature_names") != FEATURE_NAMES
        ):
            raise ValueError("Expected the trusted compatible v1 baseline artifact")
        baseline_model = FraudModel(artifact["estimator"])
        baseline_scores = [baseline_model.score(features).score for features in feature_rows]
        baseline_bytes = await asyncio.to_thread(baseline_artifact.read_bytes)
        baseline_report = {
            "model_version": artifact["model_version"],
            "artifact_sha256": hashlib.sha256(baseline_bytes).hexdigest(),
            "comparison": "Both frozen artifacts scored the SAME corrected-generator input rows",
            "thresholds": {
                str(t): asdict(binary_metrics(labels, baseline_scores, t)) for t in (40, 50, 75)
            },
            "engine_scenario_panel": await scenario_panel(baseline_model),
        }
    return {
        "report_version": 1,
        "model_version": MODEL_VERSION,
        "artifact_sha256": hashlib.sha256(artifact_bytes).hexdigest(),
        "sklearn_version": sklearn.__version__,
        "feature_names": list(FEATURE_NAMES),
        "training_seed": SEED,
        "evaluation_seed": seed,
        "generator_version": GENERATOR_VERSION,
        "frozen_v1_comparison": baseline_report,
        "population": {
            "source": "Independent-seed synthetic draws from the same generator; no customer data",
            "is_temporal_holdout": False,
            "sample_count": rows,
            "positive_labels": sum(labels),
            "synthetic_prevalence": sum(labels) / rows,
            "frozen_model_only": {
                "roc_auc": float(roc_auc_score(labels, probabilities)),
                "brier_score": float(brier_score_loss(labels, probabilities)),
                "thresholds": {
                    str(t): asdict(binary_metrics(labels, scores, t)) for t in (40, 50, 75)
                },
            },
            "missing_browser_sensitivity_at_50": {
                "description": "Same frozen model and labels; browser measurements set to missing",
                "metrics": asdict(binary_metrics(labels, missing_browser_scores, 50)),
            },
        },
        "engine_scenario_panel": await scenario_panel(model),
        "decision_sensitivity_grid": await decision_sensitivity_grid(model),
        "limitations": [
            "Synthetic metrics measure agreement with generator labels, not bank fraud detection.",
            "The evaluation seed is independent; generator assumptions are shared with training.",
            "Not a temporal, customer-disjoint or real-world holdout; no calibrated bank FPR.",
            "ML-only cutoffs are fixed illustrations, not deployed transfer thresholds.",
            "The selected engine panel is an acceptance suite, not a population accuracy estimate.",
            "without_ml retains every production rule, including the pasted-during-call rule.",
            "without_browser_biometrics removes observations; it is not model retraining.",
            "A legitimate ambiguous case gets a hold; observable signals do not prove intent.",
            "fakeredis isolates cases; latency is excluded and must be benchmarked separately.",
        ],
    }


def frozen_report() -> dict[str, Any]:
    """Check the committed input fingerprint before scoring. No fitting or threshold search."""
    from scripts.model_calibration import assess, fingerprint

    x, y = synthetic_data(FROZEN_EVALUATION_ROWS, seed=FROZEN_EVALUATION_SEED)
    digest = fingerprint(x, y)
    manifest_path = Path(__file__).resolve().parents[2] / "docs/evidence/p2p-holdout-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (
        manifest["sha256"] != digest
        or manifest["seed"] != FROZEN_EVALUATION_SEED
        or manifest["rows"] != len(y)
        or manifest["feature_names"] != list(FEATURE_NAMES)
    ):
        raise ValueError("Frozen synthetic evaluation inputs changed")
    model = load_model(MODEL_PATH, allow_training=False)
    scores = [model.score(serving_features(row)).score / 100 for row in x]
    labels = [int(label) for label in y]
    return {
        "model_version": MODEL_VERSION,
        "generator_version": GENERATOR_VERSION,
        "artifact_sha256": hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest(),
        "dataset_sha256": digest,
        "sample_count": len(labels),
        "positives": sum(labels),
        "original": assess(labels, scores, sum(labels) / len(labels)),
        "assumed_prevalence_0_0005": assess(labels, scores, 0.0005),
        "scope": "Synthetic class-conditional distributions, raw model scores, fixed cutoff 0.50. "
        "Prevalence reweighting is a sensitivity analysis and does not establish bank prevalence.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=int, default=10_000)
    parser.add_argument("--seed", type=int, default=EVALUATION_SEED)
    parser.add_argument(
        "--baseline-artifact",
        type=Path,
        help="Optional trusted v1 joblib artifact; never downloaded by this tool",
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--frozen", action="store_true", help="Run the fingerprinted calibration cohort"
    )
    args = parser.parse_args()
    if args.frozen and (
        args.rows != 10_000 or args.seed != EVALUATION_SEED or args.baseline_artifact
    ):
        parser.error("--frozen uses the predeclared seed, row count and current artifact")
    report = (
        frozen_report()
        if args.frozen
        else asyncio.run(
            evaluate_artifact(
                rows=args.rows, seed=args.seed, baseline_artifact=args.baseline_artifact
            )
        )
    )
    serialized = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
        print(f"Synthetic evidence saved to {args.output}")
    else:
        print(serialized, end="")


if __name__ == "__main__":
    main()

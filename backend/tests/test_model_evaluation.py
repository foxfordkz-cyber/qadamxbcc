"""Evidence calculations must expose denominator gaps and retain adverse cases."""

from dataclasses import replace

import pytest

from app.ml.features import Features
from app.ml.model import get_model
from scripts.evaluate_fraud_model import binary_metrics, evaluate_scenario, scenarios


def test_confusion_metrics_use_inclusive_threshold_and_correct_denominators() -> None:
    result = binary_metrics([1, 0, 1, 0], [90, 50, 40, 10], 50)
    assert (result.tp, result.fp, result.fn, result.tn) == (1, 1, 1, 1)
    assert result.positives == result.negatives == 2
    assert result.precision == result.recall == result.false_positive_rate == 0.5
    assert result.false_negative_rate == result.alert_rate == 0.5
    assert result.false_positive_rate_interval_95 is not None
    assert result.false_positive_rate_interval_95[0] < 0.5
    assert result.false_positive_rate_interval_95[1] > 0.5


def test_missing_denominators_are_unknown_not_perfect_accuracy() -> None:
    no_alerts = binary_metrics([0, 0], [0, 0], 50)
    assert no_alerts.precision is None
    assert no_alerts.recall is None
    assert no_alerts.false_positive_rate == 0
    assert no_alerts.false_positive_rate_interval_95 is not None
    assert no_alerts.false_positive_rate_interval_95[1] > 0.5
    no_negatives = binary_metrics([1, 1], [99, 99], 50)
    assert no_negatives.false_positive_rate is None
    assert no_negatives.false_positive_rate_interval_95 is None


@pytest.mark.parametrize(
    ("labels", "scores", "threshold"),
    [
        ([], [], 50),
        ([1], [], 50),
        ([2], [10], 50),
        ([1], [float("nan")], 50),
        ([0], [float("inf")], 50),
        ([1], [101], 50),
        ([0], [0], float("nan")),
    ],
)
def test_invalid_metrics_fail_instead_of_serializing_invalid_evidence(
    labels: list[int], scores: list[float], threshold: float
) -> None:
    with pytest.raises(ValueError, match="aligned nonempty"):
        binary_metrics(labels, scores, threshold)


async def test_indistinguishable_legitimate_control_is_retained_and_isolated() -> None:
    panel = {scenario.id: scenario for scenario in scenarios()}
    legitimate = panel["legitimate_but_ambiguous"]
    fraud = panel["phone_coercion"]
    assert legitimate.context == fraud.context
    assert not legitimate.fraudulent
    assert fraud.fraudulent
    first = await evaluate_scenario(legitimate, "full_hybrid")
    second = await evaluate_scenario(fraud, "full_hybrid")
    assert first == second
    assert first["status"] == "cooling_off"
    # Different evaluations cannot accumulate attempts or alter the next case.
    third = await evaluate_scenario(legitimate, "full_hybrid")
    assert third == first


async def test_ablations_remove_only_the_declared_input_or_model_uplift() -> None:
    original = next(case for case in scenarios() if case.id == "benign_call")
    pasted = replace(original, context=replace(original.context, pasted_recipient=True))
    full = await evaluate_scenario(pasted, "full_hybrid")
    no_ml = await evaluate_scenario(pasted, "without_ml")
    no_browser = await evaluate_scenario(pasted, "without_browser_biometrics")
    assert "PASTED_DURING_CALL" in full["reason_codes"]
    assert "PASTED_DURING_CALL" in no_ml["reason_codes"]
    assert "PASTED_DURING_CALL" not in no_browser["reason_codes"]
    assert no_ml["ml_score"] is None
    assert full["risk_score"] >= no_ml["risk_score"]
    assert no_ml["risk_score"] == 40
    assert no_browser["risk_score"] == 25


def test_cumulative_household_spending_is_not_rapid_mule_cashout() -> None:
    model = get_model(allow_training=False)
    # Observed on the normal seeded rehearsal: one incoming counterparty, old
    # reciprocal history, no recent settled cash-out. Ratio alone is insufficient.
    household = model.score(Features(fan_in_velocity=1, transit_ratio=2.425203))
    mule = model.score(Features(new_recipient=True, fan_in_velocity=13, transit_ratio=0.92))
    assert household.score < 40
    assert mule.score > 75
    assert household.score < mule.score

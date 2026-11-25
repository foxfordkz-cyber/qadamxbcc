from dataclasses import replace
from typing import Any

import fakeredis
import pytest
from pydantic import ValidationError
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from app.ml.familiar import VERSION, FamiliarModel, familiar_router, load_expert, transform
from app.ml.features import Features
from app.ml.model import get_model
from app.services.antifraud import AntifraudEngine
from app.services.graph import GraphStore
from scripts.evaluate_familiar_call import cohort
from scripts.evaluate_fraud_model import scenarios
from scripts.train_familiar_call import TRAIN_SEED, TRAIN_SIZE, training_observations

MEASURED = Features(
    active_call=True,
    amount_ratio=3.1,
    typing_speed_cps=0.24,
    hesitation_count=4,
    hesitation_ms=6200,
)


def test_portable_specialist_matches_sklearn_and_explains_score() -> None:
    samples, labels = training_observations(TRAIN_SIZE, TRAIN_SEED)
    scaler = StandardScaler().fit(samples)
    estimator = LogisticRegression(C=0.5, max_iter=200, random_state=TRAIN_SEED)
    estimator.fit(scaler.transform(samples), labels)
    for features in (MEASURED, replace(MEASURED, hesitation_ms=0, hesitation_count=0)):
        p = load_expert().score(features)
        expected = estimator.predict_proba(scaler.transform([transform(features.vector())]))[0, 1]
        assert p.score == pytest.approx(100 * expected, abs=1e-5)
        assert p.base_score + sum(c.contribution for c in p.contributors) == pytest.approx(p.score)
        assert p.model_version == VERSION
        assert all(c.label_ru and c.label_kk for c in p.contributors)


@pytest.mark.parametrize(
    "changes",
    [
        {"active_call": False},
        {"new_recipient": True},
        {"new_device": True},
        {"night_hour": True},
        {"deposit_withdrawal": True},
        {"independent_warning": True},
        {"paste_detected": True},
        {"typing_speed_cps": -1},
        {"hesitation_ms": -1},
    ],
)
def test_out_of_scope_uses_exact_original_prediction(changes: dict[str, Any]) -> None:
    baseline = get_model()
    f = replace(MEASURED, **changes)
    assert familiar_router(baseline).score(f) == baseline.score(f)


def test_artifact_rejects_invalid_scales_and_order() -> None:
    data = load_expert().model_dump()
    for change in ({"scale": [1, 0, 1, 1]}, {"feature_names": data["feature_names"][::-1]}):
        with pytest.raises(ValidationError):
            FamiliarModel.model_validate(data | change)


def test_missing_data_mask_keeps_ambiguous_pairs_together() -> None:
    twins = [case for group, case in cohort(4901, 25, True) if group == "ambiguous_pair"]
    for first, second in zip(twins[::2], twins[1::2], strict=True):
        assert first.fraudulent != second.fraudulent
        assert first.context == second.context


async def test_observer_failure_cannot_interrupt_a_transfer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail(self: FamiliarModel, features: Features) -> Any:
        raise ArithmeticError

    redis = fakeredis.FakeAsyncRedis()
    try:
        ctx = replace(
            scenarios()[0].context,
            active_call=True,
            is_new_recipient=False,
            recipient_input_length=12,
            typing_duration_ms=48000,
            hesitation_ms=9500,
        )
        engine = AntifraudEngine(redis, GraphStore(), observe_familiar_calls=True)
        monkeypatch.setattr(FamiliarModel, "score", fail)
        result = await engine.evaluate(ctx)
        assert result.shadow_prediction is None
        assert engine.call_observer is None
        assert result.ml_model_version == "bcc-synthetic-rf-v3"
        assert result.decision.value == "approved"
    finally:
        await redis.aclose()

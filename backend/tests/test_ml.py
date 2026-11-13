from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import fakeredis
import numpy as np
import pytest
from pydantic import ValidationError

from app.ml.features import Features
from app.ml.model import FraudModel, Prediction, get_model, load_model
from app.ml.training import synthetic_data, train
from app.schemas.transfers import TransferContextIn
from app.services.antifraud import AntifraudEngine, TransferContext
from app.services.graph import GraphStore
from scripts.benchmark_antifraud import benchmark


def test_forest_matches_sklearn_and_local_contributions_sum() -> None:
    artifact = train()
    estimator = artifact["estimator"]
    model = FraudModel(estimator)
    x, _ = synthetic_data(256, seed=7)  # independent examples, not the training set
    for row in x:
        features = Features(
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
        prediction = model.score(features)
        expected = estimator.predict_proba([features.vector()])[0, 1] * 100
        assert prediction.score == pytest.approx(expected, abs=1e-6)
        assert prediction.base_score + sum(c.contribution for c in prediction.contributors) == (
            pytest.approx(prediction.score, abs=1e-6)
        )
    assert artifact["synthetic_holdout_auc"] > 0.95
    second = train()["estimator"]
    np.testing.assert_array_equal(estimator.predict_proba(x), second.predict_proba(x))


def test_missing_artifact_trains_and_reload_is_identical(tmp_path: Path) -> None:
    path = tmp_path / "fraud_model.joblib"
    model = load_model(path)
    assert path.exists()
    assert path.stat().st_size < 1_000_000
    features = Features(active_call=True, paste_detected=True, amount_ratio=9)
    assert model.score(features) == load_model(path).score(features)


def test_synthetic_model_separates_scam_and_collection() -> None:
    model = get_model()
    safe = model.score(Features())
    collection = model.score(Features(new_recipient=True, fan_in_velocity=20))
    scam = model.score(
        Features(
            amount_ratio=12,
            active_call=True,
            deposit_withdrawal=True,
            new_recipient=True,
            paste_detected=True,
            typing_speed_cps=0.8,
            hesitation_ms=15_000,
            hesitation_count=5,
        )
    )
    assert safe.score < 40
    assert collection.score < 40
    assert scam.score > 80
    assert scam.score > model.score(Features(new_recipient=True)).score
    assert any(c.contribution > 0 for c in scam.contributors[:5])


def test_biometric_defaults_and_validation() -> None:
    context = TransferContextIn()
    assert not context.pasted_recipient
    assert context.typing_duration_ms is None
    assert context.hesitation_count == 0
    assert Features().vector()[8:10] == (-1, -1)
    for field in (
        "typing_duration_ms",
        "hesitation_count",
        "hesitation_ms",
        "recipient_input_length",
    ):
        with pytest.raises(ValidationError):
            TransferContextIn.model_validate({field: -1})
        with pytest.raises(ValidationError):
            TransferContextIn.model_validate({field: 1.5})


async def test_ml_changes_decision_without_overriding_behavioral_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = fakeredis.FakeAsyncRedis()
    try:
        engine = AntifraudEngine(redis, GraphStore())
        ctx = TransferContext(
            tx_id="blend",
            sender_id="s",
            recipient_id="r",
            device_id="d",
            amount=1000,
            occurred_at=datetime(2026, 11, 13, 9, tzinfo=UTC),
            is_new_recipient=False,
            active_call=True,
            is_new_device=False,
        )
        monkeypatch.setattr(engine.model, "score", lambda _: Prediction(0, 0, ()))
        low = await engine.evaluate(ctx)
        monkeypatch.setattr(engine.model, "score", lambda _: Prediction(100, 0, ()))
        high = await engine.evaluate(ctx)
        assert low.score == 25
        assert high.score == 40
        assert high.decision.value == "cooling_off"
        capped = await engine.evaluate(
            replace(
                ctx,
                amount=1_000_000,
                sender_avg_amount=1000,
                from_deposit=True,
                is_new_recipient=True,
                pasted_recipient=True,
            )
        )
        assert capped.score == 74
    finally:
        await redis.aclose()


async def test_hybrid_p95_budgets() -> None:
    result = await benchmark(samples=200)
    assert float(result["ml_p95_ms"]) < 2, result
    assert float(result["engine_p95_ms"]) < 15, result


async def test_biometric_features_use_measurements_and_handle_zero_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[Features] = []

    def capture(features: Features) -> Prediction:
        captured.append(features)
        return Prediction(0, 0, ())

    redis = fakeredis.FakeAsyncRedis()
    try:
        engine = AntifraudEngine(redis, GraphStore())
        monkeypatch.setattr(engine.model, "score", capture)
        ctx = TransferContext(
            tx_id="biometrics",
            sender_id="s",
            recipient_id="r",
            device_id="d",
            amount=1000,
            occurred_at=datetime(2026, 11, 13, 9, tzinfo=UTC),
            typing_duration_ms=6000,
            recipient_input_length=12,
            hesitation_ms=1000,
            hesitation_count=2,
            pasted_recipient=True,
        )
        await engine.evaluate(ctx)
        assert captured[-1].typing_speed_cps == 2
        assert captured[-1].hesitation_ms == 1000
        assert captured[-1].hesitation_count == 2
        assert captured[-1].paste_detected
        await engine.evaluate(replace(ctx, typing_duration_ms=0, hesitation_ms=None))
        assert captured[-1].typing_speed_cps == -1
        assert captured[-1].hesitation_ms == -1
    finally:
        await redis.aclose()

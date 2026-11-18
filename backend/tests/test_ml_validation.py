"""Damaged features/artifacts must fail instead of returning plausible risk scores."""

from dataclasses import replace
from pathlib import Path

import joblib
import numpy as np
import pytest
import sklearn
from sklearn.ensemble import RandomForestClassifier

from app.ml.features import FEATURE_NAMES, Features
from app.ml.model import MODEL_VERSION, FraudModel, load_model


def estimator() -> RandomForestClassifier:
    x = np.zeros((4, len(FEATURE_NAMES)))
    x[:, 0] = [0, 1, 2, 3]
    return RandomForestClassifier(n_estimators=1, max_depth=2, random_state=1).fit(x, [0, 0, 1, 1])


@pytest.mark.parametrize(
    "feature",
    [
        "amount_ratio",
        "fan_in_velocity",
        "transit_ratio",
        "typing_speed_cps",
        "hesitation_ms",
        "hesitation_count",
    ],
)
@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), float("-inf")])
def test_nonfinite_features_are_rejected_before_clipping(feature: str, invalid: float) -> None:
    value = Features()
    # Exercise runtime validation even for bad upstream values that violate the
    # dataclass's numeric annotations (for example, an infinite event count).
    object.__setattr__(value, feature, invalid)
    with pytest.raises(ValueError, match="finite"):
        FraudModel(estimator()).score(value)


@pytest.mark.parametrize("corruption", ["classes", "dimensions", "outputs", "empty"])
def test_estimator_contract_is_validated(corruption: str) -> None:
    value = estimator()
    if corruption == "classes":
        value.classes_ = np.array([0, 2])
    elif corruption == "dimensions":
        value.n_features_in_ = 1
    elif corruption == "outputs":
        value.n_outputs_ = 2
    else:
        value.estimators_ = []
    with pytest.raises(ValueError, match="contract"):
        FraudModel(value)


@pytest.mark.parametrize(
    "corruption", ["nan", "inf", "negative", "zero", "threshold", "cycle", "index", "feature"]
)
def test_tree_probabilities_and_topology_are_validated(corruption: str) -> None:
    value = estimator()
    tree = value.estimators_[0].tree_
    if corruption in {"nan", "inf", "negative"}:
        tree.value[0, 0, 1] = {"nan": float("nan"), "inf": float("inf"), "negative": -1}[corruption]
    elif corruption == "zero":
        tree.value[0] = 0
    elif corruption == "threshold":
        tree.threshold[0] = float("nan")
    elif corruption == "cycle":
        tree.children_left[0] = 0
    elif corruption == "index":
        tree.children_left[0] = tree.node_count
    else:
        tree.feature[0] = len(FEATURE_NAMES)
    with pytest.raises(ValueError, match="fraud tree"):
        FraudModel(value)


def test_inference_rejects_nonfinite_base_or_contributor() -> None:
    model = FraudModel(estimator())
    model.base_score = float("nan")
    with pytest.raises(ValueError, match="non-finite"):
        model.score(Features())
    model = FraudModel(estimator())
    model.trees = (
        replace(model.trees[0], probability=tuple(float("nan") for _ in model.trees[0].left)),
    )
    with pytest.raises(ValueError, match="non-finite"):
        model.score(Features())


def test_pilot_refuses_missing_or_mismatched_artifacts_without_training(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbid_training(path: Path) -> None:
        pytest.fail("Pilot must never train an unreviewed replacement model")

    monkeypatch.setattr("app.ml.model.train_artifact", forbid_training)
    path = tmp_path / "model.joblib"
    with pytest.raises(RuntimeError, match="missing"):
        load_model(path, allow_training=False)
    assert not path.exists()
    joblib.dump(
        {
            "model_version": "old",
            "sklearn_version": sklearn.__version__,
            "feature_names": FEATURE_NAMES,
            "estimator": estimator(),
        },
        path,
    )
    with pytest.raises(RuntimeError, match="metadata mismatch"):
        load_model(path, allow_training=False)


def test_pilot_accepts_valid_prebuilt_artifact(tmp_path: Path) -> None:
    path = tmp_path / "model.joblib"
    joblib.dump(
        {
            "model_version": MODEL_VERSION,
            "sklearn_version": sklearn.__version__,
            "feature_names": FEATURE_NAMES,
            "estimator": estimator(),
        },
        path,
    )
    prediction = load_model(path, allow_training=False).score(Features())
    assert np.isfinite(prediction.score)
    assert np.isfinite(prediction.base_score)
    assert all(np.isfinite(c.contribution) for c in prediction.contributors)

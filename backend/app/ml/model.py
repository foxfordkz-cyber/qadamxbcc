"""A trained random forest with exact, allocation-light tree-path explanations.

The serving representation copies sklearn's fitted trees once at startup. Traversal
returns the same mean leaf probability as predict_proba; it also attributes each
parent-to-child probability change to the split feature. These local contributions
are NOT SHAP values or global impurity importances. No training or disk I/O occurs
inside score(). Only locally generated, trusted joblib artifacts may be loaded.
"""

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Final

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier

from app.ml.features import FEATURE_LABELS, FEATURE_NAMES, Features

MODEL_VERSION: Final = "bcc-synthetic-rf-v1"
MODEL_PATH: Final = Path(__file__).with_name("fraud_model.joblib")


@dataclass(frozen=True, slots=True)
class Contributor:
    feature: str
    value: float
    contribution: float  # signed probability percentage points, before policy blending
    label_kk: str
    label_ru: str


@dataclass(frozen=True, slots=True)
class Prediction:
    score: float  # probability * 100, not a calibrated real-world fraud rate
    base_score: float
    contributors: tuple[Contributor, ...]


@dataclass(frozen=True, slots=True)
class Tree:
    left: tuple[int, ...]
    right: tuple[int, ...]
    feature: tuple[int, ...]
    threshold: tuple[float, ...]
    probability: tuple[float, ...]


class FraudModel:
    def __init__(self, estimator: RandomForestClassifier) -> None:
        trees: list[Tree] = []
        for estimator_tree in estimator.estimators_:
            tree = estimator_tree.tree_
            counts = tree.value[:, 0, :]
            probability = counts[:, 1] / counts.sum(axis=1)
            trees.append(
                Tree(
                    tuple(map(int, tree.children_left)),
                    tuple(map(int, tree.children_right)),
                    tuple(map(int, tree.feature)),
                    tuple(map(float, tree.threshold)),
                    tuple(map(float, probability)),
                )
            )
        self.trees = tuple(trees)
        self.base_score = sum(t.probability[0] for t in trees) * 100 / len(trees)

    def score(self, features: Features) -> Prediction:
        # sklearn predicts with float32 inputs; mirror rounding at split boundaries.
        row = tuple(map(float, np.asarray(features.vector(), dtype=np.float32)))
        contributions = [0.0] * len(FEATURE_NAMES)
        probability = 0.0
        scale = 100.0 / len(self.trees)
        for tree in self.trees:
            node = 0
            while tree.left[node] != -1:
                feature = tree.feature[node]
                child = (
                    tree.left[node] if row[feature] <= tree.threshold[node] else tree.right[node]
                )
                contributions[feature] += (tree.probability[child] - tree.probability[node]) * scale
                node = child
            probability += tree.probability[node] * scale
        ranked = sorted(range(len(row)), key=lambda i: (-abs(contributions[i]), i))
        return Prediction(
            score=max(0.0, min(100.0, probability)),
            base_score=self.base_score,
            contributors=tuple(
                Contributor(
                    FEATURE_NAMES[i],
                    row[i],
                    contributions[i],
                    *FEATURE_LABELS[i],
                )
                for i in ranked
            ),
        )


def train_artifact(path: Path = MODEL_PATH) -> dict[str, Any]:
    # Import the data generator only during training, never during inference.
    from app.ml.training import train

    artifact = train()
    path.parent.mkdir(parents=True, exist_ok=True)
    # Concurrent startup workers can only see a complete artifact.
    with NamedTemporaryFile(dir=path.parent, suffix=".joblib", delete=False) as temporary:
        temp_path = Path(temporary.name)
    try:
        joblib.dump(artifact, temp_path, compress=3)
        os.replace(temp_path, path)
    finally:
        temp_path.unlink(missing_ok=True)
    return artifact


def load_model(path: Path = MODEL_PATH) -> FraudModel:
    if not path.exists():
        artifact = train_artifact(path)
    else:
        artifact = joblib.load(path)
        if (
            artifact["model_version"] != MODEL_VERSION
            or artifact["sklearn_version"] != sklearn.__version__
            or tuple(artifact["feature_names"]) != FEATURE_NAMES
        ):
            artifact = train_artifact(path)
    return FraudModel(artifact["estimator"])


@lru_cache(maxsize=1)
def get_model() -> FraudModel:
    """Called by engine construction, before the app accepts requests."""
    return load_model()

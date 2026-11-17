"""A trained random forest with exact, allocation-light tree-path explanations.

The serving representation copies sklearn's fitted trees once at startup. Traversal
returns the same mean leaf probability as predict_proba; it also attributes each
parent-to-child probability change to the split feature. These local contributions
are NOT SHAP values or global impurity importances. No training or disk I/O occurs
inside score(). Only locally generated, trusted joblib artifacts may be loaded.
"""

import math
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
from sklearn.tree import DecisionTreeClassifier

from app.ml.features import FEATURE_LABELS, FEATURE_NAMES, Features

MODEL_VERSION: Final = "bcc-synthetic-rf-v1"
MODEL_PATH: Final = Path(__file__).with_name("fraud_model.joblib")
MAX_TREES: Final = 128
MAX_TREE_NODES: Final = 4095
MAX_TREE_DEPTH: Final = 16


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
        if (
            not isinstance(estimator, RandomForestClassifier)
            or getattr(estimator, "n_outputs_", None) != 1
            or getattr(estimator, "n_features_in_", None) != len(FEATURE_NAMES)
            or not np.array_equal(getattr(estimator, "classes_", []), [0, 1])
            or not 1 <= len(getattr(estimator, "estimators_", ())) <= MAX_TREES
        ):
            raise ValueError("Invalid binary fraud estimator contract")
        trees: list[Tree] = []
        for estimator_tree in estimator.estimators_:
            if not isinstance(estimator_tree, DecisionTreeClassifier):
                raise ValueError("Invalid fraud tree type")
            tree = estimator_tree.tree_
            size = tree.node_count
            if not 1 <= size <= MAX_TREE_NODES or tree.value.shape != (size, 1, 2):
                raise ValueError("Invalid fraud tree shape")
            if not np.isfinite(tree.threshold).all():
                raise ValueError("Non-finite fraud tree threshold")
            counts = tree.value[:, 0, :]
            totals = counts.sum(axis=1)
            if (
                not np.isfinite(counts).all()
                or not np.isfinite(totals).all()
                or (counts < 0).any()
                or (totals <= 0).any()
            ):
                raise ValueError("Invalid fraud tree probabilities")
            probability = counts[:, 1] / totals
            # Validate the topology once at load time so inference cannot loop or
            # index outside a tree, even if a trusted local artifact is damaged.
            pending = [(0, 0)]
            visited: set[int] = set()
            while pending:
                node, depth = pending.pop()
                if node in visited or not 0 <= node < size or depth > MAX_TREE_DEPTH:
                    raise ValueError("Invalid fraud tree topology")
                visited.add(node)
                left, right = int(tree.children_left[node]), int(tree.children_right[node])
                if left == right == -1:
                    continue
                if left < 0 or right < 0 or not 0 <= tree.feature[node] < len(FEATURE_NAMES):
                    raise ValueError("Invalid fraud tree split")
                pending.extend(((left, depth + 1), (right, depth + 1)))
            if len(visited) != size:
                raise ValueError("Unreachable fraud tree nodes")
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
        if not math.isfinite(self.base_score) or not 0 <= self.base_score <= 100:
            raise ValueError("Invalid model base probability")

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
        if not all(
            math.isfinite(value) for value in (probability, self.base_score, *contributions)
        ):
            raise ValueError("ML inference produced non-finite values")
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


def load_model(path: Path = MODEL_PATH, *, allow_training: bool = True) -> FraudModel:
    if not path.exists():
        if not allow_training:
            raise RuntimeError("Validated ML artifact is missing; rebuild it before pilot startup")
        artifact = train_artifact(path)
    else:
        artifact = joblib.load(path)
        if not isinstance(artifact, dict):
            raise ValueError("Invalid ML artifact container")
        if (
            artifact.get("model_version") != MODEL_VERSION
            or artifact.get("sklearn_version") != sklearn.__version__
            or artifact.get("feature_names") != FEATURE_NAMES
        ):
            if not allow_training:
                raise RuntimeError("ML artifact metadata mismatch; pilot startup refused")
            artifact = train_artifact(path)
    return FraudModel(artifact["estimator"])


@lru_cache(maxsize=2)
def get_model(*, allow_training: bool = True) -> FraudModel:
    """Called by engine construction, before the app accepts requests."""
    return load_model(allow_training=allow_training)

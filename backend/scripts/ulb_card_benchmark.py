"""Compare three fixed classifiers on the ULB/Worldline Kaggle v3 card benchmark.

Run with the Saq Bol backend Python environment (numpy, scikit-learn):
    python -m scripts.ulb_card_benchmark path/to/creditcard-v3.zip
Input: https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud (version 3).
The dataset was published by the ULB Machine Learning Group and Worldline.
No transaction rows or fitted model are written to disk.
"""

import argparse
import csv
import hashlib
import io
import json
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits  # type: ignore[import-untyped]

SEED = 261125
TRAIN_END_SECONDS = 86_400
VALIDATION_END_SECONDS = 129_600
COPIES_PER_POSITIVE = 2

Floats = npt.NDArray[np.float64]
Labels = npt.NDArray[np.int8]


def load_rows(archive: Path) -> tuple[Floats, Floats, Labels]:
    columns = ["Time", *(f"V{i}" for i in range(1, 29)), "Amount", "Class"]
    with (
        zipfile.ZipFile(archive) as z,
        z.open("creditcard.csv") as raw,
        io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as stream,
    ):
        if next(csv.reader([stream.readline()])) != columns:
            raise ValueError("Unexpected ULB data columns")
        rows = np.loadtxt(stream, delimiter=",", quotechar='"', dtype=np.float64)
    if rows.shape != (284807, len(columns)) or not np.isfinite(rows).all():
        raise ValueError("Unexpected or non-finite data")
    if set(np.unique(rows[:, -1])) != {0.0, 1.0} or rows[:, -1].sum() != 492:
        raise ValueError("Unexpected fraud labels")
    rows = rows[np.argsort(rows[:, 0], kind="stable")]
    # Only the first occurrence of a byte-identical model input can enter a split.
    # This uses neither the label nor future records to choose an earlier observation.
    features = np.ascontiguousarray(rows[:, 1:-1])
    key = np.dtype((np.void, features.shape[1] * features.itemsize))
    _, first = np.unique(features.view(key).ravel(), return_index=True)
    first.sort()
    features = features[first]
    features[:, -1] = np.log1p(features[:, -1])
    return rows[first, 0], features, rows[first, -1].astype(np.int8)


def cutoff_for_false_alert_budget(scores: Floats, labels: Labels) -> float:
    negatives = np.sort(scores[labels == 0])
    budget = len(negatives) // 1000
    # Strictly above the first excluded score also handles ties conservatively.
    return float(np.nextafter(negatives[-(budget + 1)], np.inf))


def extend_training(features: Floats, labels: Labels) -> Iterator[tuple[str, Floats, Labels]]:
    positive = features[labels == 1]
    start = np.repeat(np.arange(len(positive)), COPIES_PER_POSITIVE)
    neighbours = NearestNeighbors(n_neighbors=5).fit(positive)
    # X=None excludes the query observation itself.
    indices = neighbours.kneighbors(return_distance=False)
    rng = np.random.default_rng(SEED)
    end = indices[start, rng.integers(indices.shape[1], size=len(start))]
    fractions = rng.random((len(start), 1))
    synthetic = positive[start] + fractions * (positive[end] - positive[start])
    extra_labels = np.ones(len(start), dtype=labels.dtype)
    yield "real_only", features, labels
    yield (
        "real_plus_duplicates",
        np.vstack((features, positive[start])),
        np.r_[labels, extra_labels],
    )
    yield (
        "real_plus_synthetic",
        np.vstack((features, synthetic)),
        np.r_[labels, extra_labels],
    )


def run(path: Path) -> dict[str, Any]:
    times, x, y = load_rows(path)
    train = times < TRAIN_END_SECONDS
    validation = (times >= TRAIN_END_SECONDS) & (times < VALIDATION_END_SECONDS)
    test = times >= VALIDATION_END_SECONDS
    scaler = StandardScaler().fit(x[train])
    x = scaler.transform(x)
    metrics: dict[str, dict[str, float]] = {}
    for name, x_train, y_train in extend_training(x[train], y[train]):
        estimator = LogisticRegression(C=1.0, max_iter=500, random_state=SEED)
        estimator.fit(x_train, y_train)
        if np.max(estimator.n_iter_) >= estimator.max_iter:
            raise RuntimeError("Estimator did not converge")
        val_scores = estimator.decision_function(x[validation])
        cutoff = cutoff_for_false_alert_budget(val_scores, y[validation])
        val_false = int(np.count_nonzero((val_scores >= cutoff) & (y[validation] == 0)))
        if val_false > np.count_nonzero(y[validation] == 0) // 1000:
            raise RuntimeError("Validation alert budget exceeded")
        test_scores = estimator.decision_function(x[test])
        predicted = test_scores >= cutoff
        fraud = y[test] == 1
        caught = int(np.count_nonzero(predicted & fraud))
        false_alerts = int(np.count_nonzero(predicted & ~fraud))
        metrics[name] = {
            "rows_fitted": len(y_train),
            "cutoff_log_odds": cutoff,
            "validation_false_alerts": val_false,
            "caught": caught,
            "missed": int(fraud.sum()) - caught,
            "false_alerts": false_alerts,
            "genuine_clear": int((~fraud).sum()) - false_alerts,
            "false_alerts_per_1000_genuine": 1000 * false_alerts / int((~fraud).sum()),
            "recall": caught / int(fraud.sum()),
            "average_precision": float(average_precision_score(y[test], test_scores)),
        }
    with path.open("rb") as stream:
        sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
    return {
        "dataset": "mlg-ulb/creditcardfraud:v3",
        "archive_sha256": sha256,
        "sklearn_version": sklearn.__version__,
        "numpy_version": np.__version__,
        "seed": SEED,
        "time_boundaries_seconds": [TRAIN_END_SECONDS, VALIDATION_END_SECONDS],
        "raw_rows": 284807,
        "raw_fraud": 492,
        "repeated_inputs_removed": 284807 - len(y),
        "validation_false_alert_budget_per_1000_genuine": 1,
        "splits": {
            name: {
                "rows": int(mask.sum()),
                "fraud": int(y[mask].sum()),
                "genuine": int(mask.sum() - y[mask].sum()),
            }
            for name, mask in [
                ("train", train),
                ("validation", validation),
                ("test", test),
            ]
        },
        "models": metrics,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kaggle_zip", type=Path)
    args = parser.parse_args()
    with threadpool_limits(limits=2):
        print(json.dumps(run(args.kaggle_zip), indent=2, allow_nan=False))

"""Sensitivity to the event base rate with fixed class-conditional score distributions."""

import hashlib
import math
from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray


def fingerprint(features: NDArray[np.float32], labels: NDArray[np.int64]) -> str:
    digest = hashlib.sha256()
    digest.update(features.astype("<f4", copy=False).tobytes(order="C"))
    digest.update(labels.astype("u1", copy=False).tobytes(order="C"))
    return digest.hexdigest()


def assess(labels: Sequence[int], scores: Sequence[float], prevalence: float) -> dict[str, Any]:
    positives = sum(labels)
    negatives = len(labels) - positives
    if not positives or not negatives or not 0 < prevalence < 1 or len(labels) != len(scores):
        raise ValueError(
            "Two classes, matching scores and a prevalence between 0 and 1 are required"
        )
    bins = [[0.0, 0.0, 0.0] for _ in range(10)]
    true_alert = false_alert = brier = 0.0
    for label, score in zip(labels, scores, strict=True):
        if label not in (0, 1) or not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError("Expected a binary label and a finite probability")
        weight = prevalence / positives if label else (1 - prevalence) / negatives
        group = bins[min(9, int(score * 10))]
        group[0] += weight
        group[1] += weight * score
        group[2] += weight * label
        brier += weight * (score - label) ** 2
        if score >= 0.5:
            true_alert += label * weight
            false_alert += (1 - label) * weight
    alerts = true_alert + false_alert
    return {
        "prevalence": prevalence,
        "precision_at_50": true_alert / alerts if alerts else None,
        "recall_at_50": true_alert / prevalence,
        "fpr_at_50": false_alert / (1 - prevalence),
        "brier": brier,
        "ece_10_bins": sum(abs(predicted - observed) for _, predicted, observed in bins),
        "reliability": [
            {
                "lower": i / 10,
                "upper": (i + 1) / 10,
                "weight": weight,
                "mean_prediction": predicted / weight if weight else None,
                "observed_rate": observed / weight if weight else None,
            }
            for i, (weight, predicted, observed) in enumerate(bins)
        ],
    }

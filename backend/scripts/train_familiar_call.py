"""Train the specialist and choose its threshold using development transfers only."""

import argparse
import asyncio
import math
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from app.ml.familiar import ARTIFACT, VERSION, FamiliarModel, FamiliarRouter, transform
from app.ml.features import Features
from app.ml.model import get_model
from scripts.compare_phone_coercion import assisted_cases
from scripts.evaluate_fraud_model import evaluate_scenario

TRAIN_SEED = 204113
DEV_SEED = 37013
TRAIN_SIZE = 18000


def training_observations(n: int, seed: int) -> tuple[list[tuple[float, ...]], list[int]]:
    """Generate labelled individual sessions before converting them to sensor readings.

    Both classes include a shared interaction style. A customer's underlying
    typing speed varies independently of the label.
    """
    rng = np.random.default_rng(seed)
    samples, labels = [], []
    for _ in range(n):
        coerced = bool(rng.random() < 0.4)
        shared_style = rng.random() < 0.24
        careful = rng.random() < 0.50
        if shared_style:
            pause_rate, median_gap, median_ratio = 3.4, 7.0, 3.5
        elif coerced:
            pause_rate, median_gap, median_ratio = 5.8, 8.5, 3.7
        elif careful:
            pause_rate, median_gap, median_ratio = 1.5, 5.2, 3.6
        else:
            pause_rate, median_gap, median_ratio = 0.65, 1.9, 1.2
        pauses = int(rng.poisson(pause_rate))
        gaps = rng.lognormal(math.log(median_gap), 0.55, pauses)
        measured = gaps[gaps >= 1.5]
        duration = rng.lognormal(math.log(6.5), 0.55) + sum(gaps)
        features = Features(
            active_call=True,
            amount_ratio=float(rng.lognormal(math.log(median_ratio), 0.6)),
            typing_speed_cps=12 / duration,
            hesitation_ms=round(float(measured.sum()) * 1000),
            hesitation_count=len(measured),
        )
        samples.append(transform(features.vector()))
        labels.append(int(coerced))
    return samples, labels


def fit() -> FamiliarModel:
    samples, labels = training_observations(TRAIN_SIZE, TRAIN_SEED)
    scaler = StandardScaler().fit(samples)
    estimator = LogisticRegression(C=0.5, max_iter=200, random_state=TRAIN_SEED)
    estimator.fit(scaler.transform(samples), labels)
    return FamiliarModel.model_validate(
        {
            "center": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
            "weight": estimator.coef_[0].tolist(),
            "intercept": float(estimator.intercept_[0]),
            "threshold": 100.0,
        }
    )


async def select_threshold(expert: FamiliarModel) -> float:
    baseline = get_model()
    probe = FamiliarRouter(baseline, expert)
    cases = assisted_cases(DEV_SEED, 256, cumulative_pauses=True)
    points: list[tuple[bool, bool, float | None]] = []
    incumbent_tp = 0
    for _, case in cases:
        old = await evaluate_scenario(case, "full_hybrid", baseline)
        obs = await evaluate_scenario(case, "full_hybrid", probe, include_version=True)
        incumbent_tp += int(case.fraudulent and old["status"] != "approved")
        score = obs["ml_score"] if obs["model_version"] == VERSION else None
        points.append((case.fraudulent, obs["status"] != "approved", score))
    target = incumbent_tp + math.ceil(0.02 * sum(label for label, _, _ in points))
    choices = []
    for threshold in range(101):
        holds = [
            (label, fixed or (score is not None and score >= threshold))
            for label, fixed, score in points
        ]
        tp = sum(label and held for label, held in holds)
        fp = sum(not label and held for label, held in holds)
        if tp >= target:
            choices.append((fp, -tp, -threshold))
    if not choices:
        raise ValueError("No specialist threshold meets the development recall target")
    return float(-min(choices)[2])


async def train(output: Path) -> None:
    fitted = fit()
    threshold = await select_threshold(fitted)
    artifact = fitted.model_copy(update={"threshold": threshold})
    await asyncio.to_thread(
        output.write_bytes, (artifact.model_dump_json(indent=2) + "\n").encode()
    )
    print(f"{artifact.version}: {TRAIN_SIZE} sessions, development threshold {threshold:g}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ARTIFACT)
    asyncio.run(train(parser.parse_args().output))

"""Reproducible synthetic KZT cohorts, not real bank data or measured fraud rates.

Labels are latent scenarios (ordinary P2P, collections, scam, mule, takeover),
not copies of the production rule score. Cohorts overlap, include benign calls,
paste, deposit withdrawals and busy collection accounts, and randomly omit browser
measurements. The independent holdout measures simulation fit only.

Version 2 covers ordinary reciprocal spending and legitimate collection payouts:
the serving transit ratio is cumulative, so a high ratio alone is not mule proof.
"""

from typing import Any

import numpy as np
import sklearn
from numpy.typing import NDArray
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from app.ml.features import FEATURE_NAMES
from app.ml.model import GENERATOR_VERSION, MODEL_VERSION

SEED = 20261113


def routine_population(n: int, seed: int) -> tuple[NDArray[np.float32], NDArray[np.int64]]:
    rng = np.random.default_rng(seed)
    cohort = rng.choice(5, size=n, p=[0.60, 0.16, 0.12, 0.07, 0.05])
    y = (cohort >= 2).astype(np.int64)
    # KZT transaction scale: typical customer averages 5k–250k tenge, with tails.
    average_kzt = np.clip(rng.lognormal(np.log(30_000), 0.65, n), 5_000, 250_000)
    multipliers = np.array([1.0, 0.7, 9.0, 2.0, 4.0])[cohort]
    amount_kzt = np.clip(average_kzt * rng.lognormal(np.log(multipliers), 0.65), 100, 20_000_000)

    def flag(probabilities: list[float]) -> NDArray[np.bool_]:
        return rng.random(n) < np.asarray(probabilities)[cohort]

    night = flag([0.07, 0.05, 0.13, 0.18, 0.80])
    new = flag([0.25, 0.65, 0.94, 0.75, 0.90])
    call = flag([0.07, 0.08, 0.92, 0.08, 0.10])
    deposit = flag([0.06, 0.03, 0.72, 0.15, 0.25])
    fan_in = rng.poisson(np.array([1.0, 16.0, 2.0, 18.0, 2.0])[cohort]) + 1
    transit = rng.beta(1.2, 12, n)
    mule = cohort == 3
    transit[mule] = rng.uniform(0.7, 1.15, int(mule.sum()))
    pasted = flag([0.22, 0.25, 0.80, 0.35, 0.65])
    speed = np.clip(
        rng.lognormal(np.log(np.array([3.5, 3.5, 0.9, 5.0, 14.0])[cohort]), 0.55), 0.1, 100
    )
    hesitation = np.clip(
        rng.exponential(np.array([800, 800, 12_000, 500, 100])[cohort]), 0, 300_000
    )
    pauses = rng.poisson(np.array([0.4, 0.4, 4.0, 0.2, 0.1])[cohort])
    device = flag([0.04, 0.03, 0.15, 0.20, 0.95])
    # Unknown is distinct from zero (a measured absence of hesitation).
    speed[rng.random(n) < 0.35] = -1
    hesitation[rng.random(n) < 0.45] = -1
    pauses[rng.random(n) < 0.35] = 0
    # The graph feature is cumulative outgoing/incoming money, not a confirmed
    # rapid cash-out rate. Salary-funded spending and reciprocal household flows
    # can legitimately exceed 1. Cover this serving domain instead of teaching
    # the forest that almost every high-ratio account is a mule. These mixture
    # proportions are simulation assumptions, not measured Kazakhstani rates.
    ordinary_spending = (cohort == 0) & (rng.random(n) < 0.45)
    transit[ordinary_spending] = rng.uniform(0.25, 3.0, int(ordinary_spending.sum()))
    collection_payout = (cohort == 1) & (rng.random(n) < 0.10)
    transit[collection_payout] = rng.uniform(0.35, 1.25, int(collection_payout.sum()))
    x = np.column_stack(
        (
            amount_kzt / average_kzt,
            night,
            new,
            call,
            deposit,
            fan_in,
            transit,
            pasted,
            speed,
            hesitation,
            pauses,
            device,
        )
    )
    x[:, 0] = np.clip(x[:, 0], 0, 100)
    x[:, 5] = np.clip(x[:, 5], 0, 100)
    return x.astype(np.float32), y


def synthetic_data(
    n: int = 24_000, seed: int = SEED
) -> tuple[NDArray[np.float32], NDArray[np.int64]]:
    """Add assisted P2P transfers with overlapping legitimate and coerced behaviour."""
    assisted = n // 4
    routine_x, routine_y = routine_population(n - assisted, seed)
    rng = np.random.default_rng(np.random.SeedSequence([seed, 3]))
    coerced = rng.random(assisted) < 0.35
    # A careful legitimate payer can also pause repeatedly or make a large payment.
    careful = rng.random(assisted) < 0.18
    pauses = rng.poisson(np.where(coerced, 4.8, np.where(careful, 2.6, 0.65)))
    pause_seconds = np.where(
        pauses > 0,
        rng.lognormal(np.log(np.where(coerced, 9.5, np.where(careful, 5.5, 2.2))), 0.65),
        0,
    )
    # Model elapsed entry time for a 12-character recipient including pauses.
    keying_seconds = rng.lognormal(np.log(np.where(careful, 9, 3.7)), 0.6)
    elapsed = keying_seconds + pause_seconds * (1 + 0.30 * np.maximum(0, pauses - 1))
    cadence = 12 / elapsed
    absent = rng.random(assisted) < 0.22
    ratio = rng.lognormal(np.log(np.where(coerced, 4.2, np.where(careful, 3.6, 1.3))), 0.72)
    x = np.column_stack(
        (
            np.minimum(ratio, 100),
            rng.random(assisted) < 0.09,
            rng.random(assisted) < np.where(coerced, 0.35, 0.32),
            rng.random(assisted) < np.where(coerced, 0.94, 0.68),
            rng.random(assisted) < np.where(coerced, 0.18, 0.10),
            rng.poisson(1.0, assisted) + 1,
            np.where(rng.random(assisted) < 0.45, 0, rng.beta(1.3, 5, assisted)),
            (~absent) & (rng.random(assisted) < 0.22),
            np.where(absent, -1, cadence),
            np.where(absent, -1, np.minimum(300_000, pause_seconds * 1000)),
            np.where(absent, 0, pauses),
            rng.random(assisted) < 0.05,
        )
    ).astype(np.float32)
    return np.vstack((routine_x, x)), np.concatenate((routine_y, coerced.astype(np.int64)))


def train() -> dict[str, Any]:
    x, y = synthetic_data()
    x_train, _, y_train, _ = train_test_split(
        x,
        y,
        test_size=0.25,
        random_state=SEED,
        stratify=y,
    )
    call_estimator = RandomForestClassifier(
        n_estimators=32,
        max_depth=9,
        min_samples_leaf=10,
        max_features=0.8,
        random_state=SEED,
        n_jobs=1,
    )
    call_estimator.fit(x_train, y_train)
    # Keep the validated v2 estimator for transfers without a phone call.
    # Reproduce its exact training inputs, class balance, split and forest.
    ordinary_x, ordinary_y = routine_population(16_000, SEED)
    ordinary_train, _, ordinary_labels, _ = train_test_split(
        ordinary_x, ordinary_y, test_size=0.25, random_state=SEED, stratify=ordinary_y
    )
    estimator = RandomForestClassifier(
        n_estimators=24,
        max_depth=8,
        min_samples_leaf=12,
        max_features=0.8,
        random_state=SEED,
        n_jobs=1,
    ).fit(ordinary_train, ordinary_labels)
    # Use a separate seed for the combined model's evaluation so neither forest
    # has seen these draws. The reserved specialist split still stays out of fitting.
    x_test, y_test = synthetic_data(6_000, seed=SEED + 1)
    probabilities = estimator.predict_proba(x_test)[:, 1]
    during_call = x_test[:, FEATURE_NAMES.index("active_call")].astype(bool)
    probabilities[during_call] = call_estimator.predict_proba(x_test[during_call])[:, 1]
    return {
        "model_version": MODEL_VERSION,
        "sklearn_version": sklearn.__version__,
        "feature_names": FEATURE_NAMES,
        "seed": SEED,
        "generator_version": GENERATOR_VERSION,
        "estimator": estimator,
        "call_estimator": call_estimator,
        "training_rows": len(x_train),
        "routine_training_rows": len(ordinary_train),
        "holdout_seed": SEED + 1,
        "holdout_rows": len(x_test),
        "synthetic_holdout_auc": float(roc_auc_score(y_test, probabilities)),
        "data_source": "synthetic Kazakhstan KZT scenarios; no real customer data",
    }

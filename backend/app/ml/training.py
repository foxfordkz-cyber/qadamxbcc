"""Reproducible synthetic KZT cohorts, not real bank data or measured fraud rates.

Labels are latent scenarios (ordinary P2P, collections, scam, mule, takeover),
not copies of the production rule score. Cohorts overlap, include benign calls,
paste, deposit withdrawals and busy collection accounts, and randomly omit browser
measurements. The independent holdout measures simulation fit only.
"""

from typing import Any

import numpy as np
import sklearn
from numpy.typing import NDArray
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from app.ml.features import FEATURE_NAMES
from app.ml.model import MODEL_VERSION

SEED = 20261113


def synthetic_data(
    n: int = 16_000, seed: int = SEED
) -> tuple[NDArray[np.float32], NDArray[np.int64]]:
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


def train() -> dict[str, Any]:
    x, y = synthetic_data()
    x_train, x_test, y_train, y_test = train_test_split(
        x,
        y,
        test_size=0.25,
        random_state=SEED,
        stratify=y,
    )
    estimator = RandomForestClassifier(
        n_estimators=24,
        max_depth=8,
        min_samples_leaf=12,
        max_features=0.8,
        random_state=SEED,
        n_jobs=1,
    )
    estimator.fit(x_train, y_train)
    return {
        "model_version": MODEL_VERSION,
        "sklearn_version": sklearn.__version__,
        "feature_names": FEATURE_NAMES,
        "seed": SEED,
        "estimator": estimator,
        "training_rows": len(x_train),
        "holdout_rows": len(x_test),
        "synthetic_holdout_auc": float(
            roc_auc_score(y_test, estimator.predict_proba(x_test)[:, 1])
        ),
        "data_source": "synthetic Kazakhstan KZT scenarios; no real customer data",
    }

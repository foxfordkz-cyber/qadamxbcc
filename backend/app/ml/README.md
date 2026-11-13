# Hybrid scoring model

The backend combines existing behavioral rules, Redis velocity, the resident graph,
and a seeded scikit-learn random forest (24 trees, depth at most 8). The forest is
trained on 16,000 synthetic KZT transfers with a separate 25% holdout. Scenarios
include ordinary P2P, benign collections, phone scams, mule transit, and account
takeover, with overlapping features and missing browser measurements. No customer
records are used. Holdout performance measures the simulator, not real fraud
detection accuracy; scores need calibration and validation on representative bank
data before production deployment.

From `backend/`:

```sh
uv run python -m scripts.train_fraud_model
uv run python -m scripts.benchmark_antifraud
uv run python -m scripts.benchmark_antifraud --redis-url redis://localhost:6379/0
```

Docker trains `app/ml/fraud_model.joblib` at build time. Engine construction trains
it if absent and caches it per process before accepting requests. Artifacts are
written atomically and regenerated for changed feature/model/sklearn versions.
The generated binary is ignored by Git. Only load artifacts generated locally
from trusted source; joblib uses pickle. Corrupt artifacts fail startup rather
than silently serving a different scoring policy.

The serving representation copies fitted tree arrays once. Each request follows
the trees and averages their leaf probabilities, matching sklearn `predict_proba`
(including float32 input conversion). This avoids per-request worker scheduling
and yields local feature contributions in the same traversal. Tests compare the
scorer against sklearn on independent samples and check contribution additivity.

The residual blend is:

```text
uplift = round(0.25 * max(0, ml_score - 40))   # at most 15 points
final = min(policy_cap, original_rule_score + uplift)
```

Existing rule decisions are floors. Behavioral-only evidence remains capped at
74. ML cannot newly block a transfer without recipient mule corroboration
(cash-out, transit, shared devices, or a SOC flag). A collection or sender
pass-through signal alone cannot justify an ML-induced block. An applied uplift
adds the bilingual `ML_RISK_UPLIFT` reason, persisted in the existing risk events.

`POST /api/v1/transfers/evaluate` accepts these additional context fields:

```json
{
  "pasted_recipient": true,
  "typing_duration_ms": 12000,
  "hesitation_count": 3,
  "recipient_input_length": 12,
  "hesitation_ms": 8000
}
```

All fields are optional. The first three default to false, null, and zero.
Character count and pause duration also default to null. Typing speed is measured
characters / seconds; it is unknown when length or positive duration is absent.
The duration of pauses is never inferred from their count. Missing measurements
are encoded as -1, distinct from a measured zero. Numeric inputs are bounded and
reject negatives/fractions. Browser context is untrusted supplemental evidence;
omitting it never removes server-side graph or velocity checks. Pasting during
an active call adds the explicit `PASTED_DURING_CALL` reason in kk and ru.

Responses retain existing fields and add `ml_score` (probability × 100),
`ml_base_score`, `ml_model_version`, `ml_explanation_method`, and `ml_contributors`.
The method is `tree_path_probability`, **not SHAP**. Each contributor contains
the feature, observed value, signed probability-point contribution, and kk/ru
labels. Positive contributions increase model risk; negative ones decrease it.
Only the top five by absolute magnitude are returned, so these five alone need
not sum to the prediction. Internally, all contributions plus the forest's mean
root probability sum to its output. Contributions precede blending/policy caps.

Latency tests cover warm inference with explanation generation (<2 ms p95) and
the complete scoring engine with Redis/graph work (<15 ms p95), excluding HTTP,
SQL persistence, startup/training, and network deployment overhead. The default
benchmark uses fakeredis and reports that fact; `--redis-url` uses a real server
with unique test account keys that expire normally. Neither benchmark is a
production-load guarantee.

"""Portable inference for a familiar payee during an otherwise unremarkable call."""

import math
from functools import lru_cache
from pathlib import Path
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator

from app.ml.features import FEATURE_LABELS, FEATURE_NAMES, Features
from app.ml.model import Contributor, Prediction, RiskScorer

VERSION: Final = "bcc-familiar-call-lr-v2"
ARTIFACT: Final = Path(__file__).with_name("familiar_call.json")
INDICES: Final = (0, 8, 9, 10)
Four = tuple[FiniteFloat, FiniteFloat, FiniteFloat, FiniteFloat]


class FamiliarModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    version: Literal["bcc-familiar-call-lr-v2"] = VERSION
    feature_names: tuple[str, ...] = tuple(FEATURE_NAMES[i] for i in INDICES)
    center: Four
    scale: Four
    weight: Four
    intercept: FiniteFloat
    threshold: FiniteFloat = Field(ge=0, le=100)

    @model_validator(mode="after")
    def check_contract(self) -> "FamiliarModel":
        if self.feature_names != tuple(FEATURE_NAMES[i] for i in INDICES):
            raise ValueError("Unexpected familiar-call feature order")
        if min(self.scale) <= 0:
            raise ValueError("Expected positive feature scales")
        return self

    def score(self, features: Features) -> Prediction:
        row = features.vector()
        terms = [
            weight * (value - center) / scale
            for value, weight, center, scale in zip(
                transform(row), self.weight, self.center, self.scale, strict=True
            )
        ]
        change = math.fsum(terms)
        if not math.isfinite(change) or not all(math.isfinite(term) for term in terms):
            raise ValueError("Non-finite familiar-call contribution")
        base = sigmoid(self.intercept)
        probability = sigmoid(self.intercept + change)
        # Integrate the sigmoid slope from the training center to this input.
        # The four signed contributions add to the change in probability.
        slope = (probability - base) / change if abs(change) > 1e-10 else base * (1 - base)
        contributions = tuple(
            Contributor(FEATURE_NAMES[i], row[i], term * slope * 100, *FEATURE_LABELS[i])
            for i, term in zip(INDICES, terms, strict=True)
        )
        return Prediction(
            probability * 100,
            base * 100,
            tuple(sorted(contributions, key=lambda item: -abs(item.contribution))),
            self.version,
            "linear_probability_contributions",
            self.threshold,
        )


def sigmoid(value: float) -> float:
    exponential = math.exp(-abs(value))
    return 1 / (1 + exponential) if value >= 0 else exponential / (1 + exponential)


def transform(row: tuple[float, ...]) -> tuple[float, ...]:
    """Same bounds, feature order and log transform in training and serving."""
    return tuple(math.log1p(row[i]) for i in INDICES)


def eligible(features: Features) -> bool:
    return (
        features.active_call
        and not features.new_recipient
        and not features.night_hour
        and not features.new_device
        and not features.deposit_withdrawal
        and not features.paste_detected
        and not features.independent_warning
        and features.typing_speed_cps > 0
        and features.hesitation_ms >= 0
    )


class FamiliarRouter:
    def __init__(self, baseline: RiskScorer, expert: FamiliarModel) -> None:
        self.baseline = baseline
        self.expert = expert

    def score(self, features: Features) -> Prediction:
        return (self.expert if eligible(features) else self.baseline).score(features)


@lru_cache
def load_expert() -> FamiliarModel:
    return FamiliarModel.model_validate_json(ARTIFACT.read_bytes())


@lru_cache
def familiar_router(baseline: RiskScorer) -> FamiliarRouter:
    return FamiliarRouter(baseline, load_expert())

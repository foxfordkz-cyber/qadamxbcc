import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.models import TransactionStatus


class TransferContextIn(BaseModel):
    """Client-side signals captured by the BCC mobile app at the moment of transfer."""

    model_config = ConfigDict(extra="forbid")

    active_call: bool = Field(False, description="A phone call is active during the transfer")
    from_deposit: bool = Field(False, description="Funds were just withdrawn from a deposit")
    pasted_recipient: bool = False
    typing_duration_ms: int | None = Field(None, ge=0, le=3_600_000, strict=True)
    hesitation_count: int = Field(0, ge=0, le=100, strict=True)
    recipient_input_length: int | None = Field(
        None,
        ge=0,
        le=128,
        strict=True,
        description="Measured typed characters; needed with duration to compute characters/sec",
    )
    hesitation_ms: int | None = Field(
        None,
        ge=0,
        le=300_000,
        strict=True,
        description="Measured cumulative pauses; never inferred from hesitation_count",
    )
    is_new_device: bool | None = Field(
        None, description="Override; by default derived from the sender's registered device"
    )
    is_new_recipient: bool | None = Field(
        None, description="Override; by default derived from the transfer graph"
    )


class TransferEvaluateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sender_id: uuid.UUID
    recipient_id: uuid.UUID | None = None
    recipient_phone: str | None = Field(None, pattern=r"^\+7\d{10}$")
    recipient_iban: str | None = Field(None, pattern=r"^KZ[0-9A-Z]{18}$")
    amount: Decimal = Field(gt=0, le=Decimal("1000000000"), decimal_places=2)
    currency: str = Field("KZT", pattern=r"^KZT$")
    device_id: str | None = Field(None, min_length=1, max_length=64)
    context: TransferContextIn = Field(default_factory=TransferContextIn)
    occurred_at: AwareDatetime | None = Field(
        None, description="Event time (demo presets use it to replay night transfers)"
    )

    @model_validator(mode="after")
    def _exactly_one_recipient(self) -> Self:
        given = [self.recipient_id, self.recipient_phone, self.recipient_iban]
        if sum(v is not None for v in given) != 1:
            raise ValueError("exactly one of recipient_id, recipient_phone, recipient_iban")
        return self


class RiskReasonOut(BaseModel):
    code: str
    layer: str
    score_delta: int
    reason_kk: str
    reason_ru: str
    evidence: dict[str, Any] = Field(default_factory=dict)


class PartyOut(BaseModel):
    id: uuid.UUID
    display_name: str
    iban_masked: str


class MLContributorOut(BaseModel):
    feature: str
    value: float
    contribution: float = Field(description="Signed probability points, before blending; not SHAP")
    label_kk: str
    label_ru: str


class TransferEvaluateResponse(BaseModel):
    transaction_id: uuid.UUID
    status: TransactionStatus
    risk_score: int = Field(ge=0, le=100)
    ml_score: float = Field(ge=0, le=100)
    ml_base_score: float = Field(ge=0, le=100)
    ml_model_version: str
    ml_explanation_method: Literal["tree_path_probability"] = "tree_path_probability"
    ml_contributors: list[MLContributorOut]
    headline_kk: str
    headline_ru: str
    reasons: list[RiskReasonOut]
    reasons_kk: list[str]
    reasons_ru: list[str]
    latency_ms: float
    layer_latency_ms: dict[str, float]
    cooling_off_until: datetime | None
    is_new_recipient: bool
    is_new_device: bool
    recipient: PartyOut
    velocity: dict[str, dict[str, dict[str, float]]]
    recipient_graph: dict[str, float | int | bool]


class CoolingQuestionnaire(BaseModel):
    """Anti-scam check shown during the cooling-off period (questions mirror real scam scripts)."""

    model_config = ConfigDict(extra="forbid")

    caller_claims_bank_or_police: bool = Field(
        description="Someone calling claims to be from a bank, police or KNB"
    )
    asked_to_move_to_safe_account: bool = Field(
        description="You were asked to move money to a 'safe account'"
    )
    asked_to_keep_secret_or_install_app: bool = Field(
        description="You were told to keep it secret or install a remote-access app"
    )
    initiated_by_customer: bool = Field(description="You decided to make this transfer yourself")
    knows_recipient_personally: bool = Field(description="You personally know the recipient")


class ResolveCoolingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answers: CoolingQuestionnaire


class ResolveCoolingResponse(BaseModel):
    transaction_id: uuid.UUID
    status: TransactionStatus
    risk_score: int
    headline_kk: str
    headline_ru: str
    red_flags: list[str]
    reasons_kk: list[str]
    reasons_ru: list[str]
    resolved_at: datetime

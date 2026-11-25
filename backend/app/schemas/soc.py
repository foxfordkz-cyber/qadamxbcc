import unicodedata
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.ml.features import ExplanationMethod
from app.models import TransactionStatus
from app.schemas.transfers import (
    BankCallEvidence,
    CoolingQuestionnaire,
    MLContributorOut,
    RiskReasonOut,
    TransferContextIn,
)


class RecipientFlagRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    flagged: bool = Field(strict=True)
    note: str = Field(min_length=1, max_length=200)
    request_id: uuid.UUID | None = None
    expected_version: int | None = Field(None, ge=0, strict=True)

    @field_validator("note")
    @classmethod
    def plain_note(cls, value: str) -> str:
        value = value.strip()
        if not value or any(unicodedata.category(char).startswith("C") for char in value):
            raise ValueError("provide a nonempty plain-text reason")
        return value


class RecipientFlagState(BaseModel):
    account_id: uuid.UUID
    flagged: bool
    version: int = Field(ge=0)
    updated_at: datetime | None


class RecipientFlagResponse(RecipientFlagState):
    audit_id: uuid.UUID
    actor: str
    note: str
    previous_flagged: bool


class FeedParty(BaseModel):
    id: uuid.UUID
    full_name: str
    iban: str


class ShadowCall(BaseModel):
    model_version: str
    score: float = Field(ge=0, le=100)
    review_threshold: float = Field(ge=0, le=100)
    review_suggested: bool
    contributors: list[MLContributorOut] = Field(max_length=4)


class FeedItem(BaseModel):
    transaction_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    status: TransactionStatus
    risk_score: int
    amount: Decimal
    currency: str
    latency_ms: float
    sender: FeedParty
    recipient: FeedParty
    active_call: bool
    from_deposit: bool
    is_new_device: bool
    is_new_recipient: bool
    cooling_until: datetime | None
    resolved_at: datetime | None
    reasons: list[RiskReasonOut]
    context: TransferContextIn
    bank_call_evidence: BankCallEvidence | None = Field(
        None, exclude_if=lambda value: value is None
    )
    verification_answers: CoolingQuestionnaire | None = None
    ml_score: float | None = None
    ml_base_score: float | None = None
    shadow_call: ShadowCall | None = Field(None, exclude_if=lambda value: value is None)
    ml_model_version: str | None = None
    ml_explanation_method: ExplanationMethod | None = None
    ml_contributors: list[MLContributorOut] = Field(default_factory=list)
    layer_latency_ms: dict[str, float] = Field(default_factory=dict)
    velocity: dict[str, dict[str, dict[str, float]]] = Field(default_factory=dict)
    recipient_graph: dict[str, float | int | bool] = Field(default_factory=dict)


class SubmissionLimits(BaseModel):
    active: int
    rejected: int
    limit: int
    window_seconds: int
    cooldown_seconds: int


class FeedStats(BaseModel):
    submission_limits: SubmissionLimits | None = None
    total: int = 0
    approved: int = 0
    cooling_off: int = 0
    blocked: int = 0
    blocked_hubs: int = 0
    cancelled: int = 0
    blocked_amount: Decimal = Decimal("0")
    held_amount: Decimal = Decimal("0")
    cancelled_amount: Decimal = Decimal("0")
    avg_latency_ms: float = 0.0
    max_latency_ms: float = 0.0
    p95_latency_ms: float | None = Field(None, ge=0)
    latency_sample_size: int = Field(0, ge=0, le=500)
    latency_sample_limit: int = 500


class FeedPagination(BaseModel):
    total_filtered: int = Field(ge=0)
    offset: int = Field(ge=0, le=100_000)
    limit: int = Field(ge=1, le=200)
    has_more: bool


class FeedResponse(BaseModel):
    server_time: datetime
    items: list[FeedItem]
    stats: FeedStats
    pagination: FeedPagination


NodeRole = Literal["center", "hub", "mule", "normal"]


class Position(BaseModel):
    x: float
    y: float


class GraphNodeData(BaseModel):
    label: str
    role: NodeRole
    depth: int
    device_id: str
    flagged: bool
    suspected_mule: bool
    in_degree: int
    out_degree: int
    in_weight: float
    out_weight: float
    transit_ratio: float
    shared_device_accounts: int


class GraphNode(BaseModel):
    """React Flow node."""

    id: str
    type: str = "account"
    position: Position
    data: GraphNodeData


class GraphEdgeData(BaseModel):
    edge_type: Literal["transfer", "shared_device"]
    weight: float
    tx_count: int
    highlight: bool


class GraphEdgeOut(BaseModel):
    """React Flow edge."""

    id: str
    source: str
    target: str
    type: str = "default"
    animated: bool = False
    label: str | None = None
    data: GraphEdgeData


class GraphResponse(BaseModel):
    center: str
    depth: int = Field(ge=1, le=3)
    nodes: list[GraphNode]
    edges: list[GraphEdgeOut]

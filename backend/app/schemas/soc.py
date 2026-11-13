import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.models import TransactionStatus
from app.schemas.transfers import RiskReasonOut


class FeedParty(BaseModel):
    id: uuid.UUID
    full_name: str
    iban: str


class FeedItem(BaseModel):
    transaction_id: uuid.UUID
    created_at: datetime
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


class FeedStats(BaseModel):
    total: int = 0
    approved: int = 0
    cooling_off: int = 0
    blocked: int = 0
    avg_latency_ms: float = 0.0
    max_latency_ms: float = 0.0


class FeedResponse(BaseModel):
    server_time: datetime
    items: list[FeedItem]
    stats: FeedStats


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

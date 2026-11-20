"""Evidence returned on demand to an officer investigating one transfer."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from app.models import TransactionStatus


class TracedTransfer(BaseModel):
    transaction_id: uuid.UUID
    sender_id: uuid.UUID
    recipient_id: uuid.UUID
    settled_at: datetime
    transaction_amount: Decimal
    allocated_amount: Decimal
    first_hop: int
    last_hop: int


class FundsTrace(BaseModel):
    transaction_id: uuid.UUID
    recipient_id: uuid.UUID
    status: TransactionStatus
    amount: Decimal
    currency: str
    settled_at: datetime | None
    observed_until: datetime
    outcome: Literal["not_settled", "no_match", "possible_flow", "insufficient_evidence"]
    window_hours: int
    max_hops: int
    max_candidates: int
    candidates_examined: int = 0
    truncated: bool = False
    ambiguous_count: int = 0
    first_hop_amount: Decimal = Decimal("0.00")
    links: list[TracedTransfer]

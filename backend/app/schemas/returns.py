import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

from app.models import TransactionStatus

ReviewState = Literal["none", "reported", "appealed", "cleared", "upheld"]


class Confirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmed: Literal[True]

    @field_validator("confirmed", mode="before")
    @classmethod
    def consent(cls, value: object) -> bool:
        if value is not True:
            raise ValueError("explicit confirmation required")
        return True


class ReturnAction(Confirmation):
    action: Literal["return_to_sender", "report_redirect", "appeal"]


class ReturnReview(Confirmation):
    decision: Literal["clear", "uphold"]
    stage: Literal["reported", "appealed"]


class OriginalPayer(BaseModel):
    display_name: str
    iban_masked: str


class IncomingPayment(BaseModel):
    original_id: uuid.UUID
    received_at: datetime
    amount: Decimal
    currency: Literal["KZT"] = "KZT"
    payer: OriginalPayer
    review_state: ReviewState
    can_appeal: bool
    refund_transaction_id: uuid.UUID | None
    refund_status: TransactionStatus | None


class IncomingPage(BaseModel):
    items: list[IncomingPayment]

"""Stable mobile read models. Additive fields remain available to older clients."""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AccountView(BaseModel):
    model_config = ConfigDict(extra="allow")
    display_name: str
    card_last4: str
    balance: str
    held: str
    currency: Literal["KZT"]
    active_pause: UUID | None
    recipients: list[dict[str, Any]]
    contact_limit: int
    telegram_mode: str
    telegram_bot: str | None

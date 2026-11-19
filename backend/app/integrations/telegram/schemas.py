import unicodedata
import uuid
from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ContactState(StrEnum):
    NOT_CONFIGURED = "CONTACT_NOT_CONFIGURED"
    PENDING = "CONTACT_PENDING_CONSENT"
    VERIFIED = "CONTACT_VERIFIED"
    REVOKED = "CONTACT_REVOKED"


class NotificationState(StrEnum):
    QUEUED = "NOTIFICATION_QUEUED"
    SENT = "NOTIFICATION_SENT"
    FAILED = "DELIVERY_FAILED"
    ACKNOWLEDGED = "CONTACT_ACKNOWLEDGED"
    SUSPICION = "SUSPICION_REPORTED"
    REVOKED = "CONTACT_REVOKED"
    EXPIRED = "NOTIFICATION_EXPIRED"


class InviteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    owner_consent: Literal[True]
    language: Literal["ru", "kk"] = "ru"


class ContactPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    alias: str = Field(max_length=40)
    notifications_enabled: bool
    language: Literal["ru", "kk"]

    @field_validator("alias")
    @classmethod
    def safe_alias(cls, value: str) -> str:
        if any(unicodedata.category(c).startswith("C") for c in value):
            raise ValueError("control characters are not allowed")
        return value.strip()


class ContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    alias: str = ""
    notifications_enabled: bool = True
    id: uuid.UUID
    state: ContactState
    language: str
    created_at: datetime


class InvitationOut(BaseModel):
    contact: ContactOut
    invitation_token: str
    expires_at: datetime


class ContactsOut(BaseModel):
    state: ContactState
    contacts: list[ContactOut]


class NotificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contact_id: uuid.UUID


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    contact_id: uuid.UUID
    transaction_id: uuid.UUID
    correlation_id: uuid.UUID
    state: NotificationState
    expires_at: datetime
    error_code: str | None
    attempts: int = 0
    next_attempt_at: datetime | None = None
    advisory_only: Literal[True] = True


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    event: str
    correlation_id: uuid.UUID
    created_at: datetime


class SimulatedUpdate(BaseModel):
    """Test-only equivalent of authenticated private Telegram updates."""

    model_config = ConfigDict(extra="forbid")
    kind: Literal["start", "consent", "revoke", "ack", "suspect"]
    chat_id: int = Field(gt=0, le=2**52)
    reference: str = Field(min_length=1, max_length=80)
    message_id: str | None = Field(None, max_length=32)


class UpdateOut(BaseModel):
    resource_id: uuid.UUID
    state: str

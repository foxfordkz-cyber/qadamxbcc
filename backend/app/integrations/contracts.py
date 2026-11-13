import uuid
from datetime import datetime
from enum import StrEnum
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, model_validator

from app.integrations.nbk_mock.schemas import ExternalCheckOut, SyntheticIdentifier
from app.integrations.telegram.schemas import (
    AuditOut,
    ContactState,
    NotificationOut,
    NotificationState,
)
from app.models import TransactionStatus


class RunState(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETE = "COMPLETE"
    DEGRADED = "DEGRADED"
    FAILED = "FAILED"


ContactOutcome = (
    ContactState
    | NotificationState
    | Literal["NOT_REQUESTED", "SKIPPED_NOT_COOLING", "INTEGRATION_DISABLED", "ERROR"]
)


class OrchestrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contact_id: uuid.UUID | None = None
    gateway_identifier: SyntheticIdentifier | None = None

    @model_validator(mode="after")
    def requested(self) -> Self:
        if self.contact_id is None and self.gateway_identifier is None:
            raise ValueError("request at least one advisory integration")
        return self


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    transaction_id: uuid.UUID
    correlation_id: uuid.UUID
    state: RunState
    contact_outcome: ContactOutcome
    notification_id: uuid.UUID | None
    external_check_id: uuid.UUID | None
    attempts: int
    error_code: str | None
    created_at: datetime
    advisory_only: Literal[True] = True


class EnrichmentOut(BaseModel):
    transaction_id: uuid.UUID
    core_status: TransactionStatus
    run: RunOut | None
    notifications: list[NotificationOut]
    external_checks: list[ExternalCheckOut]
    events: list[AuditOut]
    source: Literal["MOCK"] = "MOCK"
    advisory_only: Literal[True] = True


class IntegrationHealth(BaseModel):
    status: Literal["ok", "degraded"]
    database: Literal["ok", "unavailable"]
    redis: Literal["ok", "unavailable"]
    worker: Literal["ok", "not_seen"]
    telegram_mode: Literal["disabled", "fake", "test"]
    gateway: Literal["MOCK", "disabled"]

import uuid
from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

SyntheticIdentifier = Annotated[str, Field(pattern=r"^SYN-[A-Z0-9-]{1,40}$")]


class GatewayStatus(StrEnum):
    CLEAR = "CLEAR"
    INDICATORS = "INDICATORS"
    UNKNOWN = "UNKNOWN"
    UNAVAILABLE = "UNAVAILABLE"


class GatewayErrorCode(StrEnum):
    UNKNOWN_IDENTIFIER = "UNKNOWN_IDENTIFIER"
    INTERNAL_SERVICE_ERROR = "INTERNAL_SERVICE_ERROR"
    GATEWAY_UNAVAILABLE = "GATEWAY_UNAVAILABLE"
    TIMEOUT = "TIMEOUT"
    MALFORMED_RESPONSE = "MALFORMED_RESPONSE"
    EXPIRED_RESULT = "EXPIRED_RESULT"
    UNVERIFIED_RESPONSE = "UNVERIFIED_RESPONSE"
    INCOMPLETE_CHECK = "INCOMPLETE_CHECK"


class GatewayResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: Literal["MOCK"] = "MOCK"
    identifier: SyntheticIdentifier
    status: GatewayStatus
    markers: list[Literal["SYNTHETIC_REVIEW", "SYNTHETIC_NETWORK_SIGNAL"]] = Field(
        default_factory=list
    )
    checked_at: AwareDatetime
    expires_at: AwareDatetime
    verified: bool
    error_code: GatewayErrorCode | None = None
    advisory_only: Literal[True] = True

    @model_validator(mode="after")
    def consistent_markers(self) -> Self:
        if bool(self.markers) != (self.status == GatewayStatus.INDICATORS):
            raise ValueError("markers must explain an INDICATORS result only")
        if self.expires_at <= self.checked_at:
            raise ValueError("invalid validity interval")
        return self


class ExternalCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    identifier: SyntheticIdentifier
    transaction_id: uuid.UUID | None = None


class ExternalCheckOut(BaseModel):
    id: uuid.UUID
    correlation_id: uuid.UUID
    transaction_id: uuid.UUID | None
    result: GatewayResult
    fresh: bool
    cache_hit: bool

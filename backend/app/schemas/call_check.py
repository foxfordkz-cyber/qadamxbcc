import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CallCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_id: uuid.UUID


class CallCheckResponse(BaseModel):
    check_id: uuid.UUID
    verified: bool = Field(description="True when the bank's outbound call log has a live call")
    employee_name: str | None = None
    department: str | None = None
    checked_at: datetime
    started_at: datetime | None = None
    message_kk: str
    message_ru: str
    simulated_log: bool = Field(True, description="The outbound call log is a prototype stub")


class DemoBankCallRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_id: uuid.UUID
    employee_name: str = Field("Асем Нурланова", min_length=1, max_length=80)
    department: str = Field("Кредиттеу бөлімі / Отдел кредитования", min_length=1, max_length=80)


class DemoBankCallResponse(BaseModel):
    customer_id: uuid.UUID
    employee_name: str
    department: str
    expires_in_s: int

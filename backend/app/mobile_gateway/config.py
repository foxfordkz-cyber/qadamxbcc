import uuid
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class MobileSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="BCC_MOBILE_", extra="ignore", hide_input_in_errors=True
    )
    enabled: bool = False
    ephemeral_store: bool = False
    environment: Literal["test"] = "test"
    auth_mode: Literal["rehearsal", "password"] = "rehearsal"
    client_hash: SecretStr = SecretStr("")
    admin_hash: SecretStr = SecretStr("")
    telegram_username: str = Field("", pattern=r"^[A-Za-z][A-Za-z0-9_]{3,28}[Bb][Oo][Tt]$|^$")
    client_code: SecretStr = SecretStr("")
    admin_code: SecretStr = SecretStr("")
    customer_id: uuid.UUID = uuid.UUID("00000000-0000-4000-8000-000000000001")
    officer_id: uuid.UUID = uuid.UUID("00000000-0000-4000-8000-000000000099")
    session_seconds: int = Field(1800, ge=60, le=3600)
    cors_origins: list[str] = ["https://localhost", "http://127.0.0.1:4173"]

    @model_validator(mode="after")
    def codes(self) -> Self:
        if self.enabled and self.auth_mode == "password":
            from app.mobile_gateway.passwords import valid_encoded

            hashes = [self.client_hash.get_secret_value(), self.admin_hash.get_secret_value()]
            if any(not valid_encoded(value) for value in hashes) or hashes[0] == hashes[1]:
                raise ValueError("Separate password hashes required for the two demo accounts")
            if self.customer_id == self.officer_id:
                raise ValueError("Demo account subjects must differ")
            return self
        if self.enabled:
            values = [self.client_code.get_secret_value(), self.admin_code.get_secret_value()]
            if any(len(v) < 24 or len(v) > 128 or len(set(v)) < 10 for v in values):
                raise ValueError("Two strong test access codes are required")
            if values[0] == values[1]:
                raise ValueError("Role access codes must differ")
        return self

from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class IntegrationSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="BCC_INTEGRATIONS_", env_file=".env", extra="ignore"
    )

    enabled: bool = False
    environment: Literal["local", "test"] = "local"
    signing_key: SecretStr = SecretStr("")
    telegram_mode: Literal["disabled", "fake", "test"] = "fake"
    telegram_token: SecretStr = SecretStr("")
    telegram_allowed_chat_ids: list[int] = Field(default_factory=list)
    invitation_ttl_seconds: int = Field(600, ge=60, le=900)
    adapter_timeout_seconds: float = Field(2.0, gt=0, le=5)
    rate_limit_per_minute: int = Field(30, ge=1, le=300)

    @model_validator(mode="after")
    def validate_secrets(self) -> Self:
        if self.enabled and len(self.signing_key.get_secret_value()) < 32:
            raise ValueError("enabled integrations require a signing key of at least 32 characters")
        if self.telegram_mode == "test" and (
            self.environment != "test"
            or not self.telegram_token.get_secret_value()
            or not self.telegram_allowed_chat_ids
        ):
            raise ValueError(
                "real Telegram requires test environment, token and consenting allowlist"
            )
        return self


@lru_cache
def get_integration_settings() -> IntegrationSettings:
    return IntegrationSettings()

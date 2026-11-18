"""Application settings loaded from environment variables (prefix ``BCC_``)."""

from functools import lru_cache
from typing import Any, Literal, Self
from urllib.parse import urlparse

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="BCC_", env_file=".env", extra="ignore", hide_input_in_errors=True
    )

    app_name: str = "BCC Shield Core"
    environment: Literal["local", "demo", "pilot"] = "local"
    api_prefix: str = "/api/v1"
    allow_demo_overrides: bool = True
    api_key: SecretStr | None = None
    soc_api_key: SecretStr | None = None

    database_url: str = "postgresql+asyncpg://bcc:bcc@localhost:5432/bcc_shield"
    redis_url: str = "redis://localhost:6379/0"

    cors_origins: list[str] = ["http://localhost:3000"]

    # Decision engine tuning
    cooling_off_minutes: int = Field(15, ge=1, le=1440)
    timezone: str = "Asia/Almaty"
    latency_budget_ms: float = 15.0
    max_request_bytes: int = Field(16_384, ge=1024, le=1_048_576)
    request_rate_limit_per_minute: int = Field(120, ge=1, le=10_000)

    @model_validator(mode="before")
    @classmethod
    def default_trust_policy(cls, data: Any) -> Any:
        if isinstance(data, dict) and "allow_demo_overrides" not in data:
            return {**data, "allow_demo_overrides": data.get("environment") != "pilot"}
        return data

    @model_validator(mode="after")
    def validate_pilot(self) -> Self:
        for key in (self.api_key, self.soc_api_key):
            if key is not None and not key.get_secret_value().strip():
                raise ValueError("Configured service keys must not be empty")
        if self.environment != "pilot":
            return self
        if self.allow_demo_overrides:
            raise ValueError("Pilot mode forbids demo overrides")
        keys = [key.get_secret_value() if key else "" for key in (self.api_key, self.soc_api_key)]
        if any(len(key) < 32 or len(set(key)) < 12 or key != key.strip() for key in keys):
            raise ValueError("Pilot mode requires two strong, independently generated API keys")
        if keys[0] == keys[1]:
            raise ValueError("Transfer and SOC API keys must be distinct")
        if not self.cors_origins:
            raise ValueError("Pilot mode requires explicit HTTPS CORS origins")
        for origin in self.cors_origins:
            parsed = urlparse(origin)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or "*" in origin
                or parsed.username
                or parsed.password
                or parsed.path not in ("", "/")
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("Pilot CORS origins must be explicit HTTPS origins")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()

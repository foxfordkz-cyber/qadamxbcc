"""Application settings loaded from environment variables (prefix ``BCC_``)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BCC_", env_file=".env", extra="ignore")

    app_name: str = "BCC Shield Core"
    environment: str = "local"
    api_prefix: str = "/api/v1"

    database_url: str = "postgresql+asyncpg://bcc:bcc@localhost:5432/bcc_shield"
    redis_url: str = "redis://localhost:6379/0"

    cors_origins: list[str] = ["http://localhost:3000"]

    # Decision engine tuning
    cooling_off_minutes: int = 15
    timezone: str = "Asia/Almaty"
    latency_budget_ms: float = 50.0


@lru_cache
def get_settings() -> Settings:
    return Settings()

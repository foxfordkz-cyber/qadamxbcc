"""Additive protocol discovery; contains no credentials or deployment internals."""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from app.mobile_gateway.config import MobileSettings
from app.models import TransactionStatus


class MobileCompatibility(BaseModel):
    api_major: Literal[1] = 1
    minimum_android_build: int
    transaction_statuses: list[TransactionStatus]
    update_url: Literal["https://saq-bol-bcc.zerdeliportald.workers.dev/download/android/"] = (
        "https://saq-bol-bcc.zerdeliportald.workers.dev/download/android/"
    )


def install_compatibility(app: FastAPI, config: MobileSettings) -> None:
    @app.get("/mobile/v1/compatibility", response_model=MobileCompatibility)
    async def compatibility() -> MobileCompatibility:
        return MobileCompatibility(
            minimum_android_build=config.minimum_android_build,
            transaction_statuses=list(TransactionStatus),
        )

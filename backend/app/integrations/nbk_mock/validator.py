from datetime import timedelta

from pydantic import ValidationError

from app.db.base import utcnow
from app.integrations.nbk_mock.errors import (
    ExpiredResultError,
    MalformedResponseError,
    UnverifiedResponseError,
)
from app.integrations.nbk_mock.schemas import GatewayResult


class GatewayResponseValidator:
    def validate(self, raw: object, identifier: str) -> GatewayResult:
        try:
            result = GatewayResult.model_validate(raw)
        except (ValidationError, TypeError) as exc:
            raise MalformedResponseError from exc
        if result.identifier != identifier or not result.verified:
            raise UnverifiedResponseError
        now = utcnow()
        if result.checked_at > now + timedelta(seconds=5):
            raise UnverifiedResponseError
        if result.expires_at - result.checked_at > timedelta(seconds=300):
            raise UnverifiedResponseError
        if result.expires_at <= now:
            raise ExpiredResultError
        return result

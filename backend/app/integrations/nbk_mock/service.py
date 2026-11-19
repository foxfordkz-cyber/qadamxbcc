import asyncio
import hashlib
import json
import uuid
from datetime import timedelta

from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.integrations.audit import record
from app.integrations.errors import IntegrationError
from app.integrations.nbk_mock.audit import GatewayAuditService
from app.integrations.nbk_mock.client import GatewayClient, unknown
from app.integrations.nbk_mock.errors import GatewayError
from app.integrations.nbk_mock.models import ExternalCheck
from app.integrations.nbk_mock.schemas import (
    ExternalCheckOut,
    ExternalCheckRequest,
    GatewayResult,
    GatewayStatus,
)
from app.integrations.nbk_mock.validator import GatewayResponseValidator
from app.models import Account, Transaction


class GatewayService:
    def __init__(self, session: AsyncSession, redis: Redis, client: GatewayClient) -> None:
        self.session = session
        self.redis = redis
        self.client = client
        self.audit = GatewayAuditService()

    @staticmethod
    def cache_key(identifier: str) -> str:
        return "bcc:integrations:mock:v1:" + hashlib.sha256(identifier.encode()).hexdigest()

    async def _lookup(self, identifier: str) -> tuple[GatewayResult, bool]:
        key = self.cache_key(identifier)
        try:
            async with asyncio.timeout(0.2):
                cached = await self.redis.get(key)
            if cached:
                result = GatewayResponseValidator().validate(json.loads(cached), identifier)
                return result, True
        except (RedisError, TimeoutError, ValueError, GatewayError):
            pass  # cache is advisory; stale/untrusted values never become current results
        result = await self.client.check(identifier)
        if result.verified and result.status != GatewayStatus.UNAVAILABLE:
            ttl = min(60, int((result.expires_at - utcnow()).total_seconds()))
            if ttl > 0:
                try:
                    async with asyncio.timeout(0.2):
                        await self.redis.set(key, result.model_dump_json(), ex=ttl)
                except (RedisError, TimeoutError):
                    pass
        return result, False

    async def check(
        self,
        owner: uuid.UUID,
        body: ExternalCheckRequest,
        idempotency_key: uuid.UUID,
        *,
        correlation_id: uuid.UUID | None = None,
    ) -> ExternalCheckOut:
        if await self.session.get(Account, owner) is None:
            raise IntegrationError(404, "owner_not_found")
        if body.transaction_id:
            tx = await self.session.get(Transaction, body.transaction_id)
            if tx is None or tx.sender_id != owner:
                raise IntegrationError(404, "transaction_not_found")
        stmt = select(ExternalCheck).where(
            ExternalCheck.owner_id == owner, ExternalCheck.idempotency_key == idempotency_key
        )
        prior = await self.session.scalar(stmt)
        if prior is not None:
            return self._replay(prior, body)
        row = ExternalCheck(
            id=uuid.uuid4(),
            owner_id=owner,
            identifier=body.identifier,
            transaction_id=body.transaction_id,
            idempotency_key=idempotency_key,
            correlation_id=correlation_id or uuid.uuid4(),
            cache_hit=False,
        )
        self.session.add(row)
        record(self.session, owner, row.id, row.correlation_id, "MOCK_GATEWAY_REQUESTED")
        try:
            await self.session.commit()  # reserve before the external read, unique across workers
        except IntegrityError:
            await self.session.rollback()
            prior = await self.session.scalar(stmt)
            if prior is None:
                raise IntegrationError(503, "external_check_reservation_failed") from None
            return self._replay(prior, body)
        result, row.cache_hit = await self._lookup(body.identifier)
        row.result = result.model_dump(mode="json")
        self.audit.completed(self.session, row, result.status)
        await self.session.commit()
        return self.output(row)

    def _replay(self, row: ExternalCheck, body: ExternalCheckRequest) -> ExternalCheckOut:
        if row.identifier != body.identifier or row.transaction_id != body.transaction_id:
            raise IntegrationError(409, "idempotency_key_payload_conflict")
        return self.output(row)

    @staticmethod
    def output(row: ExternalCheck) -> ExternalCheckOut:
        if row.result is None:
            if row.created_at > utcnow() - timedelta(seconds=30):
                raise IntegrationError(409, "external_check_in_progress")
            result = unknown(row.identifier, "INCOMPLETE_CHECK", unavailable=True)
            fresh = False
        else:
            result = GatewayResult.model_validate(row.result)
            fresh = result.expires_at > utcnow()
            if not fresh:
                # A replay retains identity/history but never labels an expired result as current.
                result = unknown(row.identifier, "EXPIRED_RESULT")
        return ExternalCheckOut(
            id=row.id,
            correlation_id=row.correlation_id,
            transaction_id=row.transaction_id,
            result=result,
            fresh=fresh,
            cache_hit=row.cache_hit,
        )

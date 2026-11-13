import asyncio
import uuid
from datetime import timedelta

from redis.asyncio import Redis
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.base import utcnow
from app.integrations.audit import record
from app.integrations.config import IntegrationSettings
from app.integrations.contracts import OrchestrationRequest, RunState
from app.integrations.errors import IntegrationError
from app.integrations.models import TrustedContact
from app.integrations.nbk_mock.client import GatewayClient
from app.integrations.nbk_mock.schemas import ExternalCheckRequest, GatewayStatus
from app.integrations.nbk_mock.service import GatewayService
from app.integrations.run_model import IntegrationRun
from app.integrations.telegram.schemas import ContactState
from app.integrations.telegram.service import TrustedContactService
from app.models import Transaction, TransactionStatus


class IntegrationOrchestrator:
    """Consumes committed transfer IDs; never evaluates, duplicates or resolves a transfer."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def enqueue(
        self,
        owner: uuid.UUID,
        transaction_id: uuid.UUID,
        body: OrchestrationRequest,
        idempotency_key: uuid.UUID,
    ) -> IntegrationRun:
        tx = await self.session.get(Transaction, transaction_id)
        if tx is None or tx.sender_id != owner:
            raise IntegrationError(404, "transaction_not_found")
        if body.contact_id is not None:
            contact = await self.session.get(TrustedContact, body.contact_id)
            if contact is None or contact.owner_id != owner:
                raise IntegrationError(404, "contact_not_found")
        stmt = select(IntegrationRun).where(
            or_(
                and_(
                    IntegrationRun.owner_id == owner,
                    IntegrationRun.idempotency_key == idempotency_key,
                ),
                IntegrationRun.transaction_id == transaction_id,
            )
        )
        rows = list((await self.session.scalars(stmt)).all())
        if rows:
            return self.replay(rows, transaction_id, body)
        row = IntegrationRun(
            id=uuid.uuid4(),
            owner_id=owner,
            transaction_id=transaction_id,
            idempotency_key=idempotency_key,
            correlation_id=uuid.uuid4(),
            contact_id=body.contact_id,
            gateway_identifier=body.gateway_identifier,
            state=RunState.QUEUED,
            contact_outcome="NOT_REQUESTED",
            attempts=0,
        )
        self.session.add(row)
        record(self.session, owner, row.id, row.correlation_id, "INTEGRATION_QUEUED")
        try:
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            rows = list((await self.session.scalars(stmt)).all())
            if not rows:
                raise IntegrationError(503, "integration_reservation_failed") from None
            return self.replay(rows, transaction_id, body)
        return row

    @staticmethod
    def replay(
        rows: list[IntegrationRun], transaction_id: uuid.UUID, body: OrchestrationRequest
    ) -> IntegrationRun:
        row = rows[0]
        if (
            len(rows) != 1
            or row.transaction_id != transaction_id
            or row.contact_id != body.contact_id
            or row.gateway_identifier != body.gateway_identifier
        ):
            raise IntegrationError(409, "integration_payload_conflict")
        return row


async def process_one(
    factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    cfg: IntegrationSettings,
    client: GatewayClient,
) -> bool:
    if not cfg.enabled:
        return False
    async with factory() as session:
        run = await session.scalar(
            select(IntegrationRun)
            .where(
                or_(
                    IntegrationRun.state == RunState.QUEUED,
                    and_(
                        IntegrationRun.state == RunState.RUNNING,
                        IntegrationRun.claimed_at < utcnow() - timedelta(seconds=30),
                    ),
                ),
                IntegrationRun.next_attempt_at <= utcnow(),
            )
            .order_by(IntegrationRun.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if run is None:
            return False
        if run.attempts >= 3:
            run.state = RunState.FAILED
            run.error_code = "RETRY_EXHAUSTED"
            record(session, run.owner_id, run.id, run.correlation_id, "INTEGRATION_FAILED")
            await session.commit()
            return True
        run.attempts += 1
        run.state = RunState.RUNNING
        run.claimed_at = utcnow()
        run_id = run.id
        record(session, run.owner_id, run.id, run.correlation_id, "INTEGRATION_STARTED")
        await session.commit()
    try:
        async with asyncio.timeout(10):
            await _process(factory, redis, cfg, client, run_id)
    except Exception:  # worker boundary; persist only a fixed code, never exception/provider text
        async with factory() as session:
            run = await session.get(IntegrationRun, run_id, with_for_update=True)
            assert run is not None
            run.state = RunState.FAILED if run.attempts >= 3 else RunState.QUEUED
            run.error_code = "INTEGRATION_WORKER_ERROR"
            run.next_attempt_at = utcnow() + timedelta(seconds=2**run.attempts)
            record(session, run.owner_id, run.id, run.correlation_id, f"INTEGRATION_{run.state}")
            await session.commit()
    return True


async def _process(
    factory: async_sessionmaker[AsyncSession],
    redis: Redis,
    cfg: IntegrationSettings,
    client: GatewayClient,
    run_id: uuid.UUID,
) -> None:
    async with factory() as session:
        run = await session.get(IntegrationRun, run_id)
        assert run is not None
        # Do not hold core account/transaction row locks across adapter I/O.
        tx = await session.get(Transaction, run.transaction_id)
        if tx is None:
            raise IntegrationError(404, "transaction_not_found")
        degraded = False
        if run.contact_id:
            if cfg.telegram_mode == "disabled":
                run.contact_outcome = "INTEGRATION_DISABLED"
                degraded = True
            elif (
                tx.status != TransactionStatus.COOLING_OFF
                or not tx.cooling_until
                or tx.cooling_until <= utcnow()
            ):
                run.contact_outcome = "SKIPPED_NOT_COOLING"
            else:
                contact = await session.get(TrustedContact, run.contact_id)
                if contact is None:
                    run.contact_outcome = ContactState.NOT_CONFIGURED
                elif contact.state != ContactState.VERIFIED:
                    run.contact_outcome = contact.state
                else:
                    try:
                        notification = await TrustedContactService(session, cfg).enqueue(
                            run.owner_id,
                            run.transaction_id,
                            run.contact_id,
                            correlation_id=run.correlation_id,
                        )
                        run.notification_id = notification.id
                        run.contact_outcome = notification.state
                    except IntegrationError as exc:
                        if exc.code == "active_cooling_required":
                            run.contact_outcome = "SKIPPED_NOT_COOLING"
                        else:
                            run.contact_outcome = "ERROR"
                            degraded = True
            await session.commit()
        if run.gateway_identifier:
            if cfg.gateway_enabled:
                check = await GatewayService(session, redis, client).check(
                    run.owner_id,
                    ExternalCheckRequest(
                        identifier=run.gateway_identifier, transaction_id=run.transaction_id
                    ),
                    run.id,
                    correlation_id=run.correlation_id,
                )
                run.external_check_id = check.id
                degraded |= check.result.status in {
                    GatewayStatus.UNKNOWN,
                    GatewayStatus.UNAVAILABLE,
                }
            else:
                degraded = True
                run.error_code = "MOCK_GATEWAY_DISABLED"
        run.state = RunState.DEGRADED if degraded else RunState.COMPLETE
        record(session, run.owner_id, run.id, run.correlation_id, f"INTEGRATION_{run.state}")
        await session.commit()

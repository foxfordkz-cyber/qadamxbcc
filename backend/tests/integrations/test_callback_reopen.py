"""A delivered notice can receive independent callbacks after the SQL pool closes."""

import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from app.db.base import Base
from app.db.session import build_engine, build_session_factory
from app.integrations.models import ContactNotification, IntegrationAudit
from app.integrations.telegram.schemas import NotificationState
from app.integrations.telegram.service import TrustedContactService
from app.models import Transaction, TransactionStatus
from tests.integrations.conftest import IntegrationWorld


@pytest.fixture
async def db_engine(tmp_path: Path) -> AsyncIterator[AsyncEngine]:
    engine = build_engine("sqlite+aiosqlite:///" + (tmp_path / "guardian.db").as_posix())
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        await engine.dispose()


async def test_callbacks_recover_persisted_notice_after_reopen(
    iw: IntegrationWorld, db_engine: AsyncEngine
) -> None:
    queued = await iw.queue(await iw.verified())
    assert await iw.deliver()
    notice_id = uuid.UUID(str(queued["id"]))
    async with iw.factory() as session:
        notice = await session.get(ContactNotification, notice_id)
        assert notice
        assert notice.message_id
        message_id, transfer_id = notice.message_id, notice.transaction_id

    url = str(db_engine.url)
    await db_engine.dispose()
    reopened = build_engine(url)
    try:
        sessions = build_session_factory(reopened)
        for action in ("suspect", "ack", "ack", "suspect"):
            async with sessions() as session:
                await TrustedContactService(session, iw.cfg).callback(
                    notice_id, 123, message_id, action
                )
        async with sessions() as session:
            events = list(
                await session.scalars(
                    select(IntegrationAudit).where(
                        IntegrationAudit.resource_id == notice_id,
                        IntegrationAudit.event.in_(
                            [NotificationState.SUSPICION, NotificationState.ACKNOWLEDGED]
                        ),
                    )
                )
            )
            assert sorted(row.event for row in events) == sorted(
                [NotificationState.SUSPICION, NotificationState.ACKNOWLEDGED]
            )
            assert len({row.id for row in events}) == 2
            assert all(row.created_at for row in events)
            notice = await session.get(ContactNotification, notice_id)
            tx = await session.get(Transaction, transfer_id)
            assert notice
            assert notice.state == NotificationState.SUSPICION
            assert notice.attempts == 1
            assert tx
            assert tx.status == TransactionStatus.COOLING_OFF
    finally:
        await reopened.dispose()

"""Synthetic Guardian fixture for the private PostgreSQL restart rehearsal only."""

import argparse
import asyncio
import json
import uuid

from sqlalchemy import func, select
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from app.db.base import utcnow
from app.db.session import build_engine, build_session_factory
from app.integrations.cases.models import FraudCase
from app.integrations.config import IntegrationSettings
from app.integrations.models import ContactNotification, IntegrationAudit, TrustedContact
from app.integrations.telegram.fake_adapter import FakeTelegramAdapter
from app.integrations.telegram.schemas import ContactState, NotificationState
from app.integrations.telegram.service import TrustedContactService
from app.integrations.telegram.worker import deliver_one
from app.mobile_gateway.config import MobileSettings
from app.mobile_gateway.hold_review import escalate_due


async def exercise(action: str, transaction: uuid.UUID | None) -> dict[str, str | int]:
    settings = get_settings()
    url = make_url(settings.database_url)
    cfg = IntegrationSettings()
    if (
        url.host not in {"127.0.0.1", "localhost"}
        or url.database != "practice"
        or url.drivername != "postgresql+asyncpg"
        or cfg.telegram_mode != "fake"
    ):
        raise RuntimeError("Only isolated practice PostgreSQL and Fake Adapter are allowed")
    engine = build_engine(settings.database_url)
    factory = build_session_factory(engine)
    try:
        if action == "prepare":
            async with factory() as db:
                member = TrustedContact(
                    owner_id=MobileSettings().customer_id,
                    invitation_expires_at=utcnow(),
                    language="ru",
                    alias="Synthetic guardian",
                    state=ContactState.VERIFIED,
                    contact_consented_at=utcnow(),
                    telegram_chat_id="510008",
                )
                db.add(member)
                await db.commit()
                return {"contact_id": str(member.id)}
        assert transaction is not None
        adapter = FakeTelegramAdapter()
        if action == "signal":
            assert await deliver_one(factory, adapter, cfg)
            async with factory() as db:
                notice = await db.scalar(
                    select(ContactNotification).where(
                        ContactNotification.transaction_id == transaction
                    )
                )
                assert notice is not None
                assert notice.message_id is not None
                service = TrustedContactService(db, cfg)
                for callback in ("ack", "suspect", "suspect", "ack"):
                    await service.callback(notice.id, 510008, notice.message_id, callback)
        # A fresh worker/adapter must not send this notification again.
        assert not await deliver_one(factory, FakeTelegramAdapter(), cfg)
        for _ in range(2):
            await escalate_due(factory)
        async with factory() as db:
            notice = await db.scalar(
                select(ContactNotification).where(ContactNotification.transaction_id == transaction)
            )
            assert notice is not None
            assert notice.state == NotificationState.SUSPICION
            events = list(
                (
                    await db.scalars(
                        select(IntegrationAudit.event).where(
                            IntegrationAudit.resource_id == notice.id
                        )
                    )
                ).all()
            )
            assert events.count(NotificationState.ACKNOWLEDGED) == 1
            assert events.count(NotificationState.SUSPICION) == 1
            key = uuid.uuid5(transaction, "saqbol:hold-review")
            case = await db.get(FraudCase, key)
            assert case is not None
            assert case.source == "guardian_signal"
            assert await db.scalar(select(func.count()).select_from(FraudCase)) == 1
            return {"case_id": str(key), "audit_events": len(events), "cases": 1}
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "signal", "verify"])
    parser.add_argument("transaction", type=uuid.UUID, nargs="?")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(exercise(args.action, args.transaction))))


if __name__ == "__main__":
    main()

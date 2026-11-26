"""Durable off-path delivery. An uncertain send is never automatically retried."""

import argparse
import asyncio
import logging
import uuid
from datetime import timedelta

from aiogram import Bot
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.db.base import utcnow
from app.db.session import build_engine, build_session_factory
from app.integrations.audit import record
from app.integrations.config import IntegrationSettings, get_integration_settings
from app.integrations.models import ContactNotification, TrustedContact
from app.integrations.telegram.adapter import (
    AiogramTelegramAdapter,
    ApprovalAdapter,
    DeliveryNotAttemptedError,
    RejectedDeliveryError,
    TelegramAdapter,
)
from app.integrations.telegram.fake_adapter import FakeTelegramAdapter
from app.integrations.telegram.schemas import ContactState, NotificationState
from app.integrations.telegram.templates import ALERTS
from app.models import Transaction, TransactionStatus
from app.models.family_approval import FamilyApproval
from app.services.explain import fmt_tenge
from app.services.family_approval import matches_terms

MAX_ATTEMPTS = 3


async def send_notice(
    adapter: TelegramAdapter,
    cfg: IntegrationSettings,
    row: ContactNotification,
    tx: Transaction,
    contact: TrustedContact,
    approval: FamilyApproval | None,
) -> str:
    assert contact.telegram_chat_id
    lang = contact.language
    deadline = row.expires_at.strftime("%Y-%m-%d %H:%M UTC")
    if approval and row.contact_id == approval.contact_id:
        if not isinstance(adapter, ApprovalAdapter):
            raise DeliveryNotAttemptedError("approval_adapter_unavailable")
        if not (
            contact.contact_consented_at
            and contact.owner_id == row.owner_id == tx.sender_id
            and cfg.approval_chat_allowed(tx.sender_id, int(contact.telegram_chat_id))
            and matches_terms(approval, tx)
        ):
            raise DeliveryNotAttemptedError("approval_configuration_unavailable")
        amount = fmt_tenge(float(approval.amount), with_tiyn=True)
        text = (
            f"Saq Bol · Учебный перевод\n{amount} ₸ → {approval.recipient_label}\n"
            f"Сверьте сумму и получателя с близким. Подтвердите только этот перевод до {deadline}. "
            "После паузы владелец счёта отдельно подтвердит отправку."
            if lang == "ru"
            else f"Saq Bol · Оқу аударымы\n{amount} ₸ → {approval.recipient_label}\n"
            "Сома мен алушыны жақыныңызбен тексеріңіз. "
            f"Тек осы аударымды {deadline} дейін растаңыз. "
            "Кідірістен кейін шот иесі жіберуді өзі растайды."
        )
        return await adapter.send_approval(int(contact.telegram_chat_id), text, row.id, lang)
    text = ALERTS[lang]
    if tx.active_call:
        text += (
            " Клиент отметил, что во время запроса шёл звонок."
            if lang == "ru"
            else " Клиент сұрау кезінде қоңырау болғанын белгіледі."
        )
    text += ("\nАктуально до: " if lang == "ru" else "\nМерзімі: ") + deadline
    return await adapter.send(int(contact.telegram_chat_id), text, row.id, lang)


async def deliver_one(
    factory: async_sessionmaker[AsyncSession],
    adapter: TelegramAdapter,
    cfg: IntegrationSettings,
) -> bool:
    if not cfg.enabled or cfg.telegram_mode == "disabled":
        return False
    async with factory() as session:
        row = await session.scalar(
            select(ContactNotification)
            .where(
                ContactNotification.state == NotificationState.QUEUED,
                or_(
                    ContactNotification.next_attempt_at.is_(None),
                    ContactNotification.next_attempt_at <= utcnow(),
                    ContactNotification.expires_at <= utcnow(),
                ),
                or_(
                    ContactNotification.claimed_at.is_(None),
                    ContactNotification.claimed_at < utcnow() - timedelta(seconds=30),
                ),
            )
            .order_by(ContactNotification.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if row is None:
            return False
        if row.claimed_at is not None:
            if row.claimed_at < utcnow() - timedelta(seconds=30):
                row.state = NotificationState.FAILED
                row.error_code = "delivery_uncertain"
                record(session, row.owner_id, row.id, row.correlation_id, row.state)
                await session.commit()
            return False
        row.claimed_at = utcnow()
        row.attempts += 1
        row.next_attempt_at = None
        row.error_code = None
        notification_id, contact_id = row.id, row.contact_id
        await session.commit()  # durable claim BEFORE any external side effect
    await _deliver(factory, adapter, cfg, notification_id, contact_id)
    return True


async def _deliver(
    factory: async_sessionmaker[AsyncSession],
    adapter: TelegramAdapter,
    cfg: IntegrationSettings,
    notification_id: uuid.UUID,
    contact_id: uuid.UUID,
) -> None:
    async with factory() as session:
        contact = await session.scalar(
            select(TrustedContact)
            .where(
                TrustedContact.id == contact_id,
            )
            .with_for_update()
        )
        row = await session.get(ContactNotification, notification_id, with_for_update=True)
        assert row is not None
        if row.state != NotificationState.QUEUED:
            return
        tx = await session.get(Transaction, row.transaction_id)
        if (
            contact is None
            or contact.state != ContactState.VERIFIED
            or not contact.telegram_chat_id
            or contact.contact_consented_at is None
        ):
            row.state = NotificationState.REVOKED
        elif not contact.notifications_enabled:
            row.state = NotificationState.FAILED
            row.error_code = "notifications_disabled"
        elif row.expires_at <= utcnow() or tx is None or tx.status != TransactionStatus.COOLING_OFF:
            row.state = NotificationState.EXPIRED
        else:
            approval = await session.get(FamilyApproval, tx.id)
            try:
                async with asyncio.timeout(cfg.adapter_timeout_seconds):
                    row.message_id = await send_notice(adapter, cfg, row, tx, contact, approval)
                    row.state = NotificationState.SENT
            except DeliveryNotAttemptedError as exc:
                # Terminal, not a new retry path. Only fixed local codes are persisted.
                row.state = NotificationState.FAILED
                row.error_code = (
                    str(exc)
                    if str(exc)
                    in {
                        "recipient_not_allowlisted",
                        "approval_adapter_unavailable",
                        "approval_configuration_unavailable",
                    }
                    else "delivery_preflight_rejected"
                )
            except RejectedDeliveryError as exc:
                # A persisted explicit rejection is the ONLY retryable outcome.
                # No locks/sleep across the delay. Each future claim rechecks consent/core.
                if not 0 <= exc.retry_after <= 86400:
                    row.state = NotificationState.FAILED
                    row.error_code = "invalid_retry_after"
                elif row.attempts >= MAX_ATTEMPTS:
                    row.state = NotificationState.FAILED
                    row.error_code = "retry_exhausted"
                else:
                    due = utcnow() + timedelta(seconds=max(1, exc.retry_after))
                    if due >= row.expires_at:
                        row.state = NotificationState.EXPIRED
                        row.error_code = "retry_after_expiry"
                    else:
                        row.next_attempt_at = due
                        row.claimed_at = None
                        row.error_code = "telegram_rate_limited"
                        record(
                            session, row.owner_id, row.id, row.correlation_id, "NOTIFICATION_RETRY"
                        )
            except Exception:  # isolation boundary: no provider exception text/secret is logged
                row.state = NotificationState.FAILED
                row.error_code = "delivery_failed_or_uncertain"
        if row.state != NotificationState.QUEUED:
            record(session, row.owner_id, row.id, row.correlation_id, row.state)
        await session.commit()


async def run(*, once: bool = False) -> None:
    cfg = get_integration_settings()
    if not cfg.enabled or cfg.telegram_mode == "disabled":
        return
    engine = build_engine(get_settings().database_url)
    factory = build_session_factory(engine)
    bot = Bot(cfg.telegram_token.get_secret_value()) if cfg.telegram_mode == "test" else None
    adapter: TelegramAdapter = (
        AiogramTelegramAdapter(bot, cfg.telegram_allowed_chat_ids) if bot else FakeTelegramAdapter()
    )
    try:
        while True:
            try:
                async with asyncio.timeout(15):
                    await deliver_one(factory, adapter, cfg)
            except Exception:
                logging.getLogger("bcc.integrations").warning(
                    "DELIVERY_DEPENDENCY_ERROR", extra={"event_code": "DELIVERY_DEPENDENCY_ERROR"}
                )
                if once:
                    raise SystemExit(1) from None
            if once:
                break
            await asyncio.sleep(0.5)
    finally:
        if bot:
            await bot.session.close()
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    asyncio.run(run(once=parser.parse_args().once))

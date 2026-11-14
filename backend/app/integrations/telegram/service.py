import hashlib
import secrets
import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.integrations.audit import record
from app.integrations.config import IntegrationSettings
from app.integrations.errors import IntegrationError
from app.integrations.models import ContactNotification, TrustedContact
from app.integrations.telegram.schemas import (
    ContactOut,
    ContactPreferences,
    ContactsOut,
    ContactState,
    InvitationOut,
    InviteRequest,
    NotificationState,
)
from app.models import Account, Transaction, TransactionStatus


class TrustedContactService:
    def __init__(self, session: AsyncSession, cfg: IntegrationSettings) -> None:
        self.session = session
        self.cfg = cfg

    async def invite(self, owner: uuid.UUID, body: InviteRequest) -> InvitationOut:
        # Serialize per account: cap and concurrent invitation creation are atomic on PostgreSQL.
        account = await self.session.scalar(
            select(Account).where(Account.id == owner).with_for_update(key_share=True)
        )
        if account is None:
            raise IntegrationError(404, "owner_not_found")
        existing = list(
            (
                await self.session.scalars(
                    select(TrustedContact).where(
                        TrustedContact.owner_id == owner,
                        TrustedContact.state != ContactState.REVOKED,
                    )
                )
            ).all()
        )
        if len(existing) >= 3:
            raise IntegrationError(409, "contact_limit_reached")
        token = secrets.token_urlsafe(32)
        contact = TrustedContact(
            id=uuid.uuid4(),
            owner_id=owner,
            language=body.language,
            invitation_hash=hashlib.sha256(token.encode()).hexdigest(),
            invitation_expires_at=utcnow() + timedelta(seconds=self.cfg.invitation_ttl_seconds),
            state=ContactState.PENDING,
        )
        self.session.add(contact)
        record(self.session, owner, contact.id, contact.id, "CONTACT_PENDING_CONSENT")
        await self.session.commit()
        return InvitationOut(
            contact=ContactOut.model_validate(contact),
            invitation_token=token,
            expires_at=contact.invitation_expires_at,
        )

    async def preferences(
        self, owner: uuid.UUID, contact_id: uuid.UUID, body: ContactPreferences
    ) -> TrustedContact:
        row = await self.get_contact(contact_id)
        if row.owner_id != owner:
            raise IntegrationError(404, "contact_not_found")
        if row.state == ContactState.REVOKED:
            raise IntegrationError(409, "contact_revoked")
        if (row.alias, row.notifications_enabled, row.language) != (
            body.alias,
            body.notifications_enabled,
            body.language,
        ):
            row.alias = body.alias
            row.notifications_enabled = body.notifications_enabled
            row.language = body.language
            record(self.session, owner, row.id, row.id, "CONTACT_PREFERENCES_UPDATED")
            await self.session.commit()
        return row

    async def contacts(self, owner: uuid.UUID) -> ContactsOut:
        rows = list(
            (
                await self.session.scalars(
                    select(TrustedContact)
                    .where(
                        TrustedContact.owner_id == owner,
                    )
                    .order_by(TrustedContact.created_at)
                )
            ).all()
        )
        active = [r for r in rows if r.state != ContactState.REVOKED]
        state = (
            ContactState.VERIFIED
            if any(r.state == ContactState.VERIFIED for r in active)
            else ContactState.PENDING
            if active
            else ContactState.NOT_CONFIGURED
        )
        return ContactsOut(state=state, contacts=[ContactOut.model_validate(r) for r in rows])

    async def get_contact(self, contact_id: uuid.UUID) -> TrustedContact:
        row = await self.session.scalar(
            select(TrustedContact)
            .where(
                TrustedContact.id == contact_id,
            )
            .execution_options(populate_existing=True)
            .with_for_update()
        )
        if row is None:
            raise IntegrationError(404, "contact_not_found")
        return row

    async def bind(self, token: str, chat_id: int) -> TrustedContact:
        row = await self.session.scalar(
            select(TrustedContact)
            .where(
                TrustedContact.invitation_hash == hashlib.sha256(token.encode()).hexdigest(),
            )
            .with_for_update()
        )
        if (
            row is None
            or row.state != ContactState.PENDING
            or row.invitation_expires_at <= utcnow()
        ):
            raise IntegrationError(409, "invalid_expired_or_used_invitation")
        # Only a Telegram-authenticated private sender (or privileged fake simulator) reaches here.
        row.telegram_chat_id = str(chat_id)
        row.invitation_hash = None
        record(self.session, row.owner_id, row.id, row.id, "CONTACT_BOUND_AWAITING_CONSENT")
        await self.session.commit()
        return row

    async def consent(self, contact_id: uuid.UUID, chat_id: int) -> TrustedContact:
        row = await self.get_contact(contact_id)
        if row.telegram_chat_id != str(chat_id):
            raise IntegrationError(404, "contact_not_found")
        if row.state == ContactState.VERIFIED:
            return row
        if row.state != ContactState.PENDING or row.invitation_expires_at <= utcnow():
            raise IntegrationError(409, "contact_not_pending")
        row.contact_consented_at = utcnow()
        row.state = ContactState.VERIFIED
        record(self.session, row.owner_id, row.id, row.id, row.state)
        await self.session.commit()
        return row

    async def revoke(
        self,
        contact_id: uuid.UUID,
        *,
        owner: uuid.UUID | None = None,
        chat_id: int | None = None,
    ) -> TrustedContact:
        row = await self.get_contact(contact_id)
        if not (
            (owner is not None and row.owner_id == owner)
            or (chat_id is not None and row.telegram_chat_id == str(chat_id))
        ):
            raise IntegrationError(404, "contact_not_found")
        if row.state == ContactState.REVOKED:
            return row
        row.state = ContactState.REVOKED
        row.invitation_hash = None
        row.telegram_chat_id = None
        row.alias = ""
        row.notifications_enabled = False
        record(self.session, row.owner_id, row.id, row.id, row.state)
        queued = await self.session.scalars(
            select(ContactNotification)
            .where(
                ContactNotification.contact_id == row.id,
                ContactNotification.state == NotificationState.QUEUED,
            )
            .with_for_update()
        )
        for notification in queued:
            notification.state = NotificationState.REVOKED
            record(
                self.session,
                row.owner_id,
                notification.id,
                notification.correlation_id,
                notification.state,
            )
        await self.session.commit()
        return row

    async def enqueue(
        self,
        owner: uuid.UUID,
        transaction_id: uuid.UUID,
        contact_id: uuid.UUID,
        *,
        correlation_id: uuid.UUID | None = None,
    ) -> ContactNotification:
        contact = await self.get_contact(contact_id)
        if contact.owner_id != owner:
            raise IntegrationError(404, "contact_not_found")
        tx = await self.session.get(Transaction, transaction_id)
        if tx is None or tx.sender_id != owner:
            raise IntegrationError(404, "transaction_not_found")
        prior = await self.session.scalar(
            select(ContactNotification).where(
                ContactNotification.contact_id == contact_id,
                ContactNotification.transaction_id == transaction_id,
            )
        )
        if prior is not None:
            return prior
        if not contact.notifications_enabled:
            raise IntegrationError(409, "contact_notifications_disabled")
        if contact.state != ContactState.VERIFIED or contact.contact_consented_at is None:
            raise IntegrationError(409, "contact_consent_required")
        if (
            tx.status != TransactionStatus.COOLING_OFF
            or tx.cooling_until is None
            or tx.cooling_until <= utcnow()
        ):
            raise IntegrationError(409, "active_cooling_required")
        row = ContactNotification(
            id=uuid.uuid4(),
            owner_id=owner,
            contact_id=contact_id,
            transaction_id=transaction_id,
            correlation_id=correlation_id or uuid.uuid4(),
            expires_at=tx.cooling_until,
            state=NotificationState.QUEUED,
        )
        self.session.add(row)
        record(self.session, owner, row.id, row.correlation_id, row.state)
        await self.session.commit()
        return row

    async def callback(
        self,
        notification_id: uuid.UUID,
        chat_id: int,
        message_id: str | None,
        action: str,
    ) -> ContactNotification:
        # Same contact -> notification lock order as revoke/delivery to avoid deadlocks.
        row = await self.session.get(ContactNotification, notification_id)
        if row is None:
            raise IntegrationError(404, "notification_not_found")
        contact = await self.get_contact(row.contact_id)
        await self.session.refresh(row, with_for_update=True)
        if (
            contact.state != ContactState.VERIFIED
            or contact.telegram_chat_id != str(chat_id)
            or message_id is None
            or row.message_id != message_id
        ):
            raise IntegrationError(403, "invalid_callback")
        if row.expires_at <= utcnow():
            raise IntegrationError(409, "notification_expired")
        if action not in {"ack", "suspect"}:
            raise IntegrationError(422, "invalid_callback_action")
        if row.state not in {
            NotificationState.SENT,
            NotificationState.ACKNOWLEDGED,
            NotificationState.SUSPICION,
        }:
            raise IntegrationError(409, "notification_not_sent")
        target = (
            NotificationState.SUSPICION if action == "suspect" else NotificationState.ACKNOWLEDGED
        )
        # A late acknowledgment never erases a suspicion; replay produces no audit duplicates.
        if row.state not in {target, NotificationState.SUSPICION}:
            row.state = target
            record(self.session, row.owner_id, row.id, row.correlation_id, row.state)
            await self.session.commit()
        return row

"""Linked returns for an explicitly scoped test client; SQL owns the payment relationship."""

import uuid
from datetime import UTC, datetime

from redis.exceptions import RedisError
from sqlalchemy import and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from sqlalchemy.sql.elements import ColumnElement

from app.db.locks import serialize_sender, serialized_identity
from app.models import Account, PaymentReturn, RiskEvent, Transaction, TransactionStatus
from app.schemas.returns import (
    IncomingPage,
    IncomingPayment,
    OriginalPayer,
    ReturnAction,
    ReturnReview,
    ReviewState,
)
from app.services.antifraud import AntifraudEngine
from app.services.transfers import (
    ConflictError,
    NotFoundError,
    TransferService,
    mask_iban,
    mask_name,
)

EVENTS = {
    "RETURN_REDIRECT_REPORTED": (
        "Клиент ақшаны басқа шотқа қайтаруды сұрағаны туралы хабарлады. Қайтару тоқтатылды.",
        "Клиента попросили вернуть деньги на другой счёт. Возврат приостановлен.",
    ),
    "RETURN_APPEAL_REQUESTED": (
        "Клиент өтінішті қайта қарауды сұрады.",
        "Клиент попросил пересмотреть обращение.",
    ),
    "RETURN_REVIEW_CLEARED": (
        "Қауіпсіздік қызметі бастапқы жіберушіге қайтаруға рұқсат берді.",
        "Служба безопасности разрешила возврат первоначальному отправителю.",
    ),
    "RETURN_REVIEW_UPHELD": (
        "Қауіпсіздік қызметі қайтаруға қойылған шектеуді сақтады.",
        "Служба безопасности сохранила ограничение на возврат.",
    ),
}


def eligible(owner: uuid.UUID) -> ColumnElement[bool]:
    outgoing = exists(
        select(PaymentReturn.original_id)
        .where(PaymentReturn.refund_transaction_id == Transaction.id)
        .correlate(Transaction)
    )
    return and_(
        Transaction.recipient_id == owner,
        Transaction.sender_id != owner,
        Transaction.status == TransactionStatus.APPROVED,
        Transaction.currency == "KZT",
        Transaction.amount > 0,
        Transaction.amount <= 1_000_000_000,
        func.coalesce(Transaction.resolved_at, Transaction.created_at) <= datetime.now(UTC),
        ~outgoing,
    )


def review_state(record: PaymentReturn | None) -> ReviewState:
    if record is None:
        return "none"
    if record.decision == "uphold":
        return "upheld"
    if record.decision == "clear":
        return "cleared"
    if record.appealed_at:
        return "appealed"
    return "reported" if record.reported_at else "none"


class ReturnService:
    def __init__(self, session: AsyncSession, owner: uuid.UUID) -> None:
        self.session = session
        self.owner = owner

    async def incoming(self, original_id: uuid.UUID | None = None) -> IncomingPage:
        refund = aliased(Transaction)
        settled_at = func.coalesce(Transaction.resolved_at, Transaction.created_at)
        stmt = (
            select(
                Transaction.id,
                settled_at,
                Transaction.amount,
                Account.full_name,
                Account.iban,
                PaymentReturn,
                refund.status,
            )
            .select_from(Transaction)
            .join(Account, Account.id == Transaction.sender_id)
            .outerjoin(PaymentReturn, PaymentReturn.original_id == Transaction.id)
            .outerjoin(refund, refund.id == PaymentReturn.refund_transaction_id)
            .where(eligible(self.owner))
            .order_by(settled_at.desc(), Transaction.id.desc())
            .limit(25)
        )
        if original_id is not None:
            stmt = stmt.where(Transaction.id == original_id)
        rows = await self.session.execute(stmt)
        return IncomingPage(
            items=[
                IncomingPayment(
                    original_id=identity,
                    received_at=at,
                    amount=amount,
                    payer=OriginalPayer(display_name=mask_name(name), iban_masked=mask_iban(iban)),
                    review_state=review_state(record),
                    can_appeal=bool(
                        record and record.decision == "uphold" and not record.appealed_at
                    ),
                    refund_transaction_id=record.refund_transaction_id if record else None,
                    refund_status=status,
                )
                for identity, at, amount, name, iban, record, status in rows
            ]
        )

    async def detail(self, original_id: uuid.UUID) -> IncomingPayment:
        items = (await self.incoming(original_id)).items
        if not items:
            raise NotFoundError("incoming_payment_not_found")
        return items[0]

    async def _original(self, original_id: uuid.UUID) -> Transaction:
        original = await self.session.scalar(
            select(Transaction)
            .where(Transaction.id == original_id, eligible(self.owner))
            .with_for_update()
        )
        if original is None:
            raise NotFoundError("incoming_payment_not_found")
        return original

    def _event(
        self,
        original: Transaction,
        code: str,
        source: str,
        now: datetime,
        *,
        actor: str | None = None,
    ) -> None:
        kk, ru = EVENTS[code]
        self.session.add(
            RiskEvent(
                transaction_id=original.id,
                layer="questionnaire",
                rule_code=code,
                reason_kk=kk,
                reason_ru=ru,
                score_delta=0,
                created_at=now,
                evidence={"source": source, **({"actor": actor} if actor else {})},
            )
        )
        original.updated_at = now

    async def act(
        self, original_id: uuid.UUID, body: ReturnAction, engine: AntifraudEngine
    ) -> IncomingPayment:
        scoring_error: RedisError | None = None
        if body.action == "return_to_sender":
            try:
                await engine.ensure_consistent()
            except RedisError as exc:
                scoring_error = exc
        async with serialized_identity(self.session, original_id):
            if body.action == "return_to_sender":
                await serialize_sender(self.session, self.owner)
            original = await self._original(original_id)
            record = await self.session.get(PaymentReturn, original.id) or PaymentReturn(
                original_id=original.id
            )
            now = datetime.now(UTC)
            if body.action == "return_to_sender":
                if record.refund_transaction_id:
                    return await self.detail(original_id)
                if review_state(record) not in ("none", "cleared"):
                    raise ConflictError("return_under_review")
                if scoring_error:
                    raise scoring_error
                await TransferService(self.session, engine).evaluate_linked_return(original, record)
            elif body.action == "report_redirect":
                if record.reported_at:
                    return await self.detail(original_id)
                if record.refund_transaction_id:
                    raise ConflictError("return_already_initiated")
                record.reported_at = now
                self._event(original, "RETURN_REDIRECT_REPORTED", "customer_report", now)
                self.session.add(record)
                await self.session.commit()
            else:
                if record.appealed_at:
                    return await self.detail(original_id)
                if review_state(record) != "upheld" or record.refund_transaction_id:
                    raise ConflictError("return_appeal_unavailable")
                record.appealed_at, record.decision, record.reviewed_at = now, None, None
                self._event(original, "RETURN_APPEAL_REQUESTED", "customer_report", now)
                await self.session.commit()
            return await self.detail(original_id)

    async def review(
        self, original_id: uuid.UUID, body: ReturnReview, actor: str
    ) -> IncomingPayment:
        async with serialized_identity(self.session, original_id):
            original = await self._original(original_id)
            record = await self.session.get(PaymentReturn, original.id)
            if record is None or not record.reported_at:
                raise ConflictError("return_report_required")
            if body.stage != ("appealed" if record.appealed_at else "reported"):
                raise ConflictError("return_review_stale")
            if record.decision == body.decision:
                return await self.detail(original_id)
            if record.decision or record.refund_transaction_id:
                raise ConflictError("return_review_finished")
            now = datetime.now(UTC)
            record.reviewed_at, record.decision = now, body.decision
            code = "RETURN_REVIEW_CLEARED" if body.decision == "clear" else "RETURN_REVIEW_UPHELD"
            self._event(original, code, "soc_review", now, actor=actor)
            await self.session.commit()
            return await self.detail(original_id)

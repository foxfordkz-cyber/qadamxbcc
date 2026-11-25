"""Transfer orchestration: resolve parties → score → persist → update graph."""

import hashlib
import json
import uuid
from collections import Counter
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import asdict, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from redis.exceptions import RedisError
from sqlalchemy import and_, case, exists, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.locks import serialize_sender, serialized_identity
from app.integrations.models import ContactNotification
from app.integrations.telegram.schemas import NotificationState
from app.models import (
    AbandonedRequest,
    Account,
    EdgeType,
    GraphEdge,
    PaymentReturn,
    ProjectionEvent,
    RiskEvent,
    Transaction,
    TransactionStatus,
)
from app.models.family_approval import FamilyApprovalPolicy
from app.schemas.transfers import (
    AbandonRequestResponse,
    BankCallEvidence,
    CoolingQuestionnaire,
    MLContributorOut,
    PartyOut,
    PostCallRequest,
    RiskReasonOut,
    TransferContextIn,
    TransferEvaluateRequest,
    TransferEvaluateResponse,
)
from app.services import demo_funds, explain, family_approval
from app.services.antifraud import (
    ACTIVE_HOLD_RULE,
    AMOUNT_SPIKE_RATIO,
    NEW_PAYEE_NIGHT_RULE,
    POST_CALL_PAYMENT_RULE,
    AntifraudEngine,
    Evaluation,
    TransferContext,
    is_large_first_day_followup,
    split_total_threshold,
)
from app.services.call_check import CallCheck, CallCheckService
from app.services.graph import MAX_GRAPH_NEIGHBOURS, GraphCapacityError, GraphStore
from app.services.velocity import MAX_HISTORY_ROWS, SettledPayee, VelocityCapacityError

QUESTIONNAIRE_LAYER = "questionnaire"
BLOCKED_AFTER_RED_FLAG_SCORE = 90

POST_CALL_MESSAGES = {
    "POST_CALL_ENDED": (
        "Клиент қоңыраудың аяқталғанын хабарлады. Аударым кідіртілген.",
        "Клиент сообщил о завершении звонка. Перевод удерживается.",
    ),
    "POST_CALL_RECOGNIZED": (
        "Қоңыраудан кейін клиент аударымды өзі бастағанын растады.",
        "После звонка клиент подтвердил, что сам начал перевод.",
    ),
    "POST_CALL_SCAM_REPORTED": (
        "Қоңыраудан кейін клиент алаяқтық туралы хабарлады. Аударым тоқтатылды.",
        "После звонка клиент сообщил об обмане. Перевод отменён.",
    ),
}


def _post_call_event(tx: Transaction, code: str, now: datetime) -> None:
    kk, ru = POST_CALL_MESSAGES[code]
    tx.risk_events.append(
        RiskEvent(
            layer=QUESTIONNAIRE_LAYER,
            rule_code=code,
            score_delta=0,
            reason_kk=kk,
            reason_ru=ru,
            evidence={"source": "customer_report"},
            created_at=now,
        )
    )
    tx.updated_at = now


RED_FLAG_LABELS: dict[str, tuple[str, str]] = {
    "caller_claims_bank_or_police": (
        "қоңырау шалушы банк немесе полиция қызметкері болып таныстырды",
        "звонящий представился сотрудником банка или полиции",
    ),
    "asked_to_move_to_safe_account": (
        "қаражатты «қауіпсіз шотқа» аударуды сұрады",
        "просили перевести деньги на «безопасный счёт»",
    ),
    "asked_to_keep_secret_or_install_app": (
        "құпия сақтауды немесе қашықтан басқару қолданбасын орнатуды сұрады",
        "просили сохранить тайну или установить приложение удалённого доступа",
    ),
    "initiated_by_customer": (
        "аударымды клиенттің өзі бастамаған",
        "перевод инициирован не самим клиентом",
    ),
    "unknown_recipient_under_pressure": (
        "клиент алушыны жеке танымайды және ақшаны қоңырау кезінде, қоңыраудағы "
        "өтініштен кейін немесе депозиттен алып аударуда",
        "клиент не знает получателя лично и переводит деньги во время звонка, "
        "по просьбе из недавнего звонка или после снятия с депозита",
    ),
}


class DomainError(Exception):
    """Base error mapped to an HTTP status by the API layer."""


class NotFoundError(DomainError):
    pass


class ConflictError(DomainError):
    pass


class InvalidTransferError(DomainError):
    pass


def mask_name(full_name: str) -> str:
    parts = full_name.split()
    if len(parts) < 2:
        return full_name
    return f"{parts[0]} {parts[1][0]}."


def mask_iban(iban: str) -> str:
    return f"{iban[:2]}** •••• {iban[-4:]}"


def red_flags(answers: CoolingQuestionnaire, tx: Transaction) -> list[str]:
    flags: list[str] = []
    if answers.caller_claims_bank_or_police:
        flags.append("caller_claims_bank_or_police")
    if answers.asked_to_move_to_safe_account:
        flags.append("asked_to_move_to_safe_account")
    if answers.asked_to_keep_secret_or_install_app:
        flags.append("asked_to_keep_secret_or_install_app")
    if not answers.initiated_by_customer:
        flags.append("initiated_by_customer")
    if not answers.knows_recipient_personally and (
        tx.active_call
        or tx.from_deposit
        or any(r.rule_code == POST_CALL_PAYMENT_RULE for r in tx.risk_events)
    ):
        flags.append("unknown_recipient_under_pressure")
    return flags


def register_account(graph: GraphStore, account: Account) -> None:
    """Sync an account's label, home device and SOC flag into the resident graph."""
    graph.add_account(
        str(account.id),
        label=account.full_name,
        device_id=account.device_id,
        flagged=account.is_flagged,
        flag_version=account.flag_version,
    )


async def upsert_transfer_edge(
    session: AsyncSession, source: uuid.UUID, target: uuid.UUID, amount: float, at: datetime
) -> None:
    insert = pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
    stmt = insert(GraphEdge).values(
        id=uuid.uuid4(),
        source_id=source,
        target_id=target,
        edge_type=EdgeType.TRANSFER,
        weight=amount,
        tx_count=1,
        last_seen_at=at,
    )
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[GraphEdge.source_id, GraphEdge.target_id, GraphEdge.edge_type],
            set_={
                "weight": GraphEdge.weight + stmt.excluded.weight,
                "tx_count": GraphEdge.tx_count + 1,
                "last_seen_at": case(
                    (GraphEdge.last_seen_at < at, at), else_=GraphEdge.last_seen_at
                ),
            },
        )
    )


def risk_reasons(tx: Transaction) -> list[RiskReasonOut]:
    return [
        RiskReasonOut(
            code=e.rule_code,
            layer=e.layer,
            score_delta=e.score_delta,
            reason_kk=e.reason_kk,
            reason_ru=e.reason_ru,
            evidence=(
                {**(e.evidence or {}), "recorded_at": e.created_at.isoformat()}
                if e.rule_code.startswith(("POST_CALL_", "RETURN_"))
                else e.evidence or {}
            ),
        )
        for e in sorted(
            tx.risk_events,
            key=lambda e: (
                e.layer != QUESTIONNAIRE_LAYER,
                -e.created_at.timestamp() if e.layer == QUESTIONNAIRE_LAYER else -e.score_delta,
            ),
        )
    ]


def transfer_detail(
    tx: Transaction, recipient: Account, *, minutes: int = 15
) -> TransferEvaluateResponse:
    """Historical ML remains the original decision snapshot; lifecycle fields are current."""
    snapshot = dict(tx.evaluation_snapshot or {})
    reasons = risk_reasons(tx)
    headline = (
        ("Аударым тоқтатылды.", "Перевод отменён.")
        if tx.status is TransactionStatus.CANCELLED
        else explain.headline(
            tx.status,
            minutes=minutes,
            continuing_hold=any(r.code == ACTIVE_HOLD_RULE for r in reasons),
            post_call_request=any(r.code == POST_CALL_PAYMENT_RULE for r in reasons),
            night_spike=any(r.code == NEW_PAYEE_NIGHT_RULE for r in reasons),
        )
    )
    snapshot.update(
        transaction_id=tx.id,
        created_at=tx.created_at,
        updated_at=tx.updated_at,
        status=tx.status,
        risk_score=tx.risk_score,
        headline_kk=headline[0],
        headline_ru=headline[1],
        reasons=reasons,
        reasons_kk=[r.reason_kk for r in reasons],
        reasons_ru=[r.reason_ru for r in reasons],
        latency_ms=tx.latency_ms,
        cooling_off_until=tx.cooling_until,
        is_new_recipient=tx.is_new_recipient,
        is_new_device=tx.is_new_device,
        recipient=PartyOut(
            id=recipient.id,
            display_name=mask_name(recipient.full_name),
            iban_masked=mask_iban(recipient.iban),
        ),
        amount=tx.amount,
        context=tx.context_snapshot
        or {
            "active_call": tx.active_call,
            "from_deposit": tx.from_deposit,
            "is_new_device": tx.is_new_device,
            "is_new_recipient": tx.is_new_recipient,
        },
        server_time=datetime.now(UTC),
        verification_answers=tx.verification_answers,
        resolved_at=tx.resolved_at,
        red_flags=red_flags(CoolingQuestionnaire.model_validate(tx.verification_answers), tx)
        if tx.verification_answers
        else [],
    )
    for key in ("layer_latency_ms", "velocity", "recipient_graph"):
        snapshot.setdefault(key, {})
    snapshot.setdefault("ml_contributors", [])
    if not tx.evaluation_snapshot:
        snapshot["ml_explanation_method"] = None
    return TransferEvaluateResponse.model_validate(snapshot)


class TransferService:
    def __init__(self, session: AsyncSession, engine: AntifraudEngine) -> None:
        self.session = session
        self.engine = engine

    @asynccontextmanager
    async def _serialized(self, identity: uuid.UUID) -> AsyncIterator[None]:
        async with serialized_identity(self.session, identity):
            yield

    async def _load(self, tx_id: uuid.UUID, *, locked: bool = False) -> Transaction:
        stmt = (
            select(Transaction)
            .where(Transaction.id == tx_id)
            .options(selectinload(Transaction.risk_events), selectinload(Transaction.recipient))
        )
        if locked:
            stmt = stmt.with_for_update()
        tx = (await self.session.execute(stmt)).scalar_one_or_none()
        if tx is None:
            raise NotFoundError(f"transaction {tx_id} not found")
        return tx

    async def detail(self, tx_id: uuid.UUID) -> TransferEvaluateResponse:
        # Persisted decisions remain readable while scoring projections are unavailable.
        tx = await self._load(tx_id)
        return transfer_detail(tx, tx.recipient, minutes=self.engine.cooling_off_minutes)

    async def _get_account(self, account_id: uuid.UUID) -> Account:
        account = await self.session.get(Account, account_id, populate_existing=True)
        if account is None:
            raise NotFoundError(f"account {account_id} not found")
        return account

    async def _check_disputed_funds(self, sender: Account, debit: Decimal) -> None:
        if not sender.has_dispute_history:
            return
        reserved = await demo_funds.disputed_total(self.session, sender.id)
        if not reserved:
            return
        # A pilot with an imported dispute requires an authoritative bank balance.
        if not self.engine.use_virtual_wallet:
            raise ConflictError("disputed_amount_reserved")
        available = await demo_funds.posted_balance(self.session, sender.id) - reserved
        if debit > available:
            raise ConflictError("disputed_amount_reserved")

    async def _resolve_recipient(
        self, req: TransferEvaluateRequest, sender: Account
    ) -> tuple[Account, bool, SettledPayee]:
        stmt = select(
            Account, GraphEdge.tx_count, GraphEdge.weight, GraphEdge.last_seen_at
        ).outerjoin(
            GraphEdge,
            and_(
                GraphEdge.source_id == sender.id,
                GraphEdge.target_id == Account.id,
                GraphEdge.edge_type == EdgeType.TRANSFER,
            ),
        )
        if req.recipient_id is not None:
            stmt = stmt.where(Account.id == req.recipient_id)
        elif req.recipient_phone is not None:
            stmt = stmt.where(Account.phone == req.recipient_phone)
        else:
            stmt = stmt.where(Account.iban == req.recipient_iban)
        # A confirmed flag cannot commit between our authoritative recipient read
        # and the persisted decision. SOC writes take the conflicting row lock.
        result = await self.session.execute(stmt.with_for_update(read=True, of=Account))
        row = result.one_or_none()
        if row is None:
            raise NotFoundError("recipient not found")
        account, lifetime_count, weight, last_settled = row
        now = datetime.now(UTC)
        if lifetime_count == 1 and now - timedelta(days=1) < last_settled <= now:
            # The single edge is written on approval with the bank's settlement
            # time. Its amount and age are available without another ledger read.
            return account, False, SettledPayee(1, weight, weight)
        threshold = split_total_threshold(float(sender.avg_tx_amount))
        if (lifetime_count or 0) < 2 or round((weight or 0) + float(req.amount), 2) < threshold:
            return account, not lifetime_count, SettledPayee()

        # A concurrent approval can already be committed while its Redis outbox
        # is still pending. Confirm the pair from the ledger under the sender lock.
        # The existing sender/status/settlement index bounds the scan to one day.
        settled_at = func.coalesce(Transaction.resolved_at, Transaction.created_at)
        recent = (
            select(Transaction.recipient_id, Transaction.amount)
            .where(
                Transaction.sender_id == sender.id,
                Transaction.status == TransactionStatus.APPROVED,
                settled_at > now - timedelta(days=1),
                settled_at <= now,
            )
            .limit(MAX_HISTORY_ROWS + 1)
            .subquery()
        )
        same_payee = recent.c.recipient_id == account.id
        size, count, total, largest = (
            await self.session.execute(
                select(
                    func.count(),
                    func.count().filter(same_payee),
                    func.sum(recent.c.amount).filter(same_payee),
                    func.max(recent.c.amount).filter(same_payee),
                ).select_from(recent)
            )
        ).one()
        if size > MAX_HISTORY_ROWS:
            raise VelocityCapacityError("Settled sender history exceeds scorer capacity")
        if count != lifetime_count:
            # Older history or a legacy edge without its complete ledger: familiarity wins.
            return account, False, SettledPayee()
        return account, False, SettledPayee(count, float(total), float(largest))

    async def _refresh_device_peers(
        self, sender: Account, recipient: Account, supplied_device: str
    ) -> None:
        """Load complete, bounded current rosters before either scoring boundary."""
        graph = self.engine.graph
        devices = {sender.device_id, recipient.device_id, supplied_device} - {""}
        known_ids = {
            uuid.UUID(identity)
            for device in devices
            for identity in graph.registered_accounts_on_device(device)
        }
        peers: list[Account] = []
        if devices:
            # Include cached members whose registration may have moved away. Loading
            # only today's matching device values would leave those old links behind.
            conditions = [Account.device_id.in_(devices)]
            if known_ids:
                conditions.append(Account.id.in_(known_ids))
            row_limit = len(devices) * MAX_GRAPH_NEIGHBOURS + len(known_ids)
            peers = list(
                await self.session.scalars(
                    select(Account)
                    .where(or_(*conditions))
                    .limit(row_limit + 1)
                    .execution_options(populate_existing=True)
                )
            )
            sizes = Counter(peer.device_id for peer in peers if peer.device_id in devices)
            if len(peers) > row_limit or any(
                size > MAX_GRAPH_NEIGHBOURS for size in sizes.values()
            ):
                raise GraphCapacityError("Device cluster exceeds the supported graph capacity")
        # Validate the whole roster before applying rows; an incomplete view cannot
        # authorize a release. Supplied IDs are queried, never linked to a pilot sender.
        register_account(graph, sender)
        register_account(graph, recipient)
        for peer in peers:
            register_account(graph, peer)

    async def evaluate(self, req: TransferEvaluateRequest) -> TransferEvaluateResponse:
        # A committed response is safe to replay while Redis/projection delivery is
        # unavailable. New decisions still fail closed; healthy retries continue
        # draining the outbox before returning. Keep synchronization outside the
        # SQL transaction because it needs its own pooled session.
        scoring_error: RedisError | None = None
        try:
            await self.engine.ensure_consistent()
        except RedisError as exc:
            scoring_error = exc
        identity = req.request_id or uuid.uuid4()
        async with self._serialized(identity):
            payload = req.model_dump(mode="json", exclude={"request_id"})
            if not req.context.payment_requested_after_call:
                # Preserve request IDs hashed before this optional signal was introduced.
                payload["context"].pop("payment_requested_after_call", None)
            payload["amount"] = str(req.amount.quantize(Decimal("0.01")))
            request_hash = hashlib.sha256(
                json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()
            if req.request_id:
                if await self.session.get(AbandonedRequest, req.request_id) is not None:
                    raise ConflictError("request_id was abandoned and cannot execute")
                existing = (
                    await self.session.execute(
                        select(Transaction).where(
                            (Transaction.request_id == req.request_id)
                            | (Transaction.id == req.request_id)
                        )
                    )
                ).scalar_one_or_none()
                if existing is not None:
                    if (
                        existing.request_id != req.request_id
                        or existing.request_hash != request_hash
                    ):
                        raise ConflictError("request_id was already used with a different payload")
                    snapshot = dict(existing.evaluation_snapshot)
                    # Earlier saved evaluations predate the additive timestamps.
                    # A replay is the original decision; its update time is not
                    # the timestamp of a later cancellation or questionnaire.
                    snapshot.setdefault("created_at", existing.created_at)
                    snapshot.setdefault("updated_at", existing.created_at)
                    return TransferEvaluateResponse.model_validate(snapshot)
            if scoring_error is not None:
                raise scoring_error
            await serialize_sender(self.session, req.sender_id)
            return await self._evaluate(req, identity, request_hash)

    async def _active_hold(
        self, sender_id: uuid.UUID, recipient_id: uuid.UUID, now: datetime
    ) -> Transaction | None:
        """Find one original pause without trusting browser flags or graph cache.

        A different established recipient remains usable. A retry to the held
        recipient stays subject to that pause even if it was already familiar.
        Descendants never become anchors, and cancelled/expired anchors no longer
        apply. The row share lock orders this decision against cancel/resolve.
        """
        familiar = exists().where(
            GraphEdge.source_id == sender_id,
            GraphEdge.target_id == recipient_id,
            GraphEdge.edge_type == EdgeType.TRANSFER,
            GraphEdge.tx_count > 0,
        )
        descendant = exists().where(
            RiskEvent.transaction_id == Transaction.id,
            RiskEvent.rule_code == ACTIVE_HOLD_RULE,
        )
        return await self.session.scalar(
            select(Transaction)
            .where(
                Transaction.sender_id == sender_id,
                Transaction.status == TransactionStatus.COOLING_OFF,
                Transaction.created_at <= now,
                Transaction.cooling_until > now,
                Transaction.created_at > now - timedelta(minutes=self.engine.cooling_off_minutes),
                or_(Transaction.recipient_id == recipient_id, ~familiar),
                ~descendant,
            )
            .order_by(Transaction.cooling_until, Transaction.id)
            .limit(1)
            .with_for_update(read=True)
        )

    async def evaluate_linked_return(self, original: Transaction, record: PaymentReturn) -> None:
        """Score the reversal while the original payment and its sender are serialized."""
        request = TransferEvaluateRequest(
            sender_id=original.recipient_id, recipient_id=original.sender_id, amount=original.amount
        )
        await self._evaluate(request, uuid.uuid4(), None, refund=record)

    async def _scoring_context(
        self,
        req: TransferEvaluateRequest,
        tx_id: uuid.UUID,
        sender: Account,
    ) -> tuple[Account, TransferContext, CallCheck | None]:
        recipient, is_first_payment, first_day_payee = await self._resolve_recipient(req, sender)
        if sender.id == recipient.id:
            raise InvalidTransferError("sender and recipient must differ")
        active_hold = await self._active_hold(sender.id, recipient.id, datetime.now(UTC))
        active_until = (
            min(
                active_hold.cooling_until,
                active_hold.created_at + timedelta(minutes=self.engine.cooling_off_minutes),
            )
            if active_hold is not None and active_hold.cooling_until is not None
            else None
        )

        device_id = req.device_id or sender.device_id
        await self._refresh_device_peers(sender, recipient, device_id)

        is_new_device = (
            req.context.is_new_device
            if req.context.is_new_device is not None
            else device_id != sender.device_id
        )
        occurred_at = (req.occurred_at or datetime.now(UTC)).astimezone(UTC)
        bank_check = await CallCheckService(self.engine.redis).result_for(
            req.context.bank_call_check_id, sender.id
        )
        ctx = TransferContext(
            tx_id=str(tx_id),
            sender_id=str(sender.id),
            recipient_id=str(recipient.id),
            amount=float(req.amount),
            device_id=device_id,
            occurred_at=occurred_at,
            sender_avg_amount=float(sender.avg_tx_amount),
            first_day_payee=first_day_payee,
            settled_payee_is_new=is_first_payment,
            active_call=req.context.active_call or req.context.call_pressure_answer == "on_call",
            payment_requested_after_call=(
                req.context.payment_requested_after_call
                or req.context.call_pressure_answer == "after_call"
            ),
            from_deposit=req.context.from_deposit,
            is_new_device=is_new_device,
            is_new_recipient=req.context.is_new_recipient,
            recipient_flagged=recipient.is_flagged,
            active_hold_id=str(active_hold.id) if active_hold is not None else None,
            active_hold_until=active_until,
            active_hold_recipient_changed=(
                active_hold is not None and active_hold.recipient_id != recipient.id
            ),
            pasted_recipient=req.context.pasted_recipient,
            duress=req.context.duress,
            typing_duration_ms=req.context.typing_duration_ms,
            hesitation_count=req.context.hesitation_count,
            recipient_input_length=req.context.recipient_input_length,
            hesitation_ms=req.context.hesitation_ms,
            bank_call_denied=bank_check is not None and not bank_check.verified,
        )
        return (
            recipient,
            self.engine.trusted_context(ctx, known_device_id=sender.device_id),
            bank_check,
        )

    async def should_ask_about_call(self, req: TransferEvaluateRequest) -> bool:
        """Read-only review of a material payment, before recording its first attempt."""
        sender = await self._get_account(req.sender_id)
        if sender.avg_tx_amount <= 0 or req.amount < sender.avg_tx_amount:
            return False
        recipient, ctx, _ = await self._scoring_context(req, uuid.uuid4(), sender)
        if recipient.is_flagged or ctx.active_hold_id is not None:
            return False
        if not ctx.settled_payee_is_new and req.amount < AMOUNT_SPIKE_RATIO * sender.avg_tx_amount:
            return False
        if ctx.settled_payee_is_new and req.amount >= family_approval.MIN_AMOUNT:
            policy = await self.session.get(FamilyApprovalPolicy, sender.id)
            if policy and family_approval.active(policy, datetime.now(UTC)):
                return False
        neutral = await self.engine.evaluate(ctx, record_attempt=False)
        if neutral.decision != TransactionStatus.APPROVED:
            return False
        reported = await self.engine.evaluate(replace(ctx, active_call=True), record_attempt=False)
        if reported.decision != TransactionStatus.APPROVED:
            return True
        # The ended-call rule checks the settled SQL relationship. A resident
        # graph edge can make the active-call simulation see a familiar payee.
        if not ctx.settled_payee_is_new and not is_large_first_day_followup(
            ctx.first_day_payee, ctx.amount, ctx.sender_avg_amount
        ):
            return False
        ended = await self.engine.evaluate(
            replace(ctx, payment_requested_after_call=True), record_attempt=False
        )
        return ended.decision != TransactionStatus.APPROVED

    async def _evaluate(
        self,
        req: TransferEvaluateRequest,
        tx_id: uuid.UUID,
        request_hash: str | None,
        *,
        refund: PaymentReturn | None = None,
    ) -> TransferEvaluateResponse:
        sender = await self._get_account(req.sender_id)
        recipient, ctx, bank_check = await self._scoring_context(req, tx_id, sender)
        await self._check_disputed_funds(sender, req.amount)

        evaluation = await self.engine.evaluate(ctx)

        received_at = datetime.now(UTC)
        protected = None
        if (
            ctx.settled_payee_is_new
            and req.amount >= family_approval.MIN_AMOUNT
            and evaluation.decision != TransactionStatus.BLOCKED
        ):
            policy = await self.session.get(FamilyApprovalPolicy, sender.id)
            if policy and family_approval.active(policy, received_at):
                protected = policy
                evaluation = family_approval.hold_for_approval(evaluation)
        inherited_until = (
            ctx.active_hold_until
            if any(r.code == ACTIVE_HOLD_RULE for r in evaluation.reasons)
            else None
        )
        cooling_until = (
            inherited_until or received_at + timedelta(minutes=evaluation.cooling_off_minutes)
            if evaluation.decision is TransactionStatus.COOLING_OFF
            else None
        )
        tx = Transaction(
            id=tx_id,
            request_id=req.request_id,
            request_hash=request_hash,
            sender_id=sender.id,
            recipient_id=recipient.id,
            amount=req.amount,
            currency=req.currency,
            status=evaluation.decision,
            risk_score=evaluation.score,
            latency_ms=evaluation.latency_ms,
            device_id=ctx.device_id,
            active_call=ctx.active_call,
            from_deposit=ctx.from_deposit,
            is_new_device=ctx.is_new_device,
            is_new_recipient=evaluation.is_new_recipient,
            cooling_until=cooling_until,
            created_at=received_at,
            updated_at=received_at,
            verification_answers=None,
            resolved_at=None,
        )
        tx.risk_events = [
            RiskEvent(
                layer=r.layer,
                rule_code=r.code,
                score_delta=r.score_delta,
                reason_kk=r.reason_kk,
                reason_ru=r.reason_ru,
                evidence=r.evidence,
                created_at=received_at,
            )
            for r in evaluation.reasons
        ]
        tx.context_snapshot = TransferContextIn(
            active_call=ctx.active_call,
            call_pressure_answer=req.context.call_pressure_answer,
            payment_requested_after_call=ctx.payment_requested_after_call,
            from_deposit=ctx.from_deposit,
            is_new_device=ctx.is_new_device,
            is_new_recipient=evaluation.is_new_recipient,
            pasted_recipient=ctx.pasted_recipient,
            duress=ctx.duress,
            typing_duration_ms=ctx.typing_duration_ms,
            hesitation_count=ctx.hesitation_count,
            recipient_input_length=ctx.recipient_input_length,
            hesitation_ms=ctx.hesitation_ms,
            bank_call_check_id=req.context.bank_call_check_id,
        ).model_dump(mode="json")
        response = self.evaluation_response(tx, evaluation, recipient)
        if bank_check is not None:
            response.bank_call_evidence = BankCallEvidence(
                outbound_call_listed=bank_check.verified,
                checked_at=datetime.fromisoformat(bank_check.checked_at),
            )
        decision_snapshot = response.model_dump(mode="json")
        shadow = evaluation.shadow_prediction
        if shadow is not None and shadow.review_threshold is not None:
            # The officer feed reads this immutable observation. Customer response
            # schemas also filter it out on retries and historical detail reads.
            decision_snapshot["shadow_call"] = {
                "model_version": shadow.model_version,
                "score": round(shadow.score, 4),
                "review_threshold": shadow.review_threshold,
                "review_suggested": shadow.score >= shadow.review_threshold,
                "contributors": [asdict(item) for item in shadow.contributors],
            }
        tx.evaluation_snapshot = decision_snapshot
        self.session.add(tx)
        if protected is not None:
            await self.session.flush()
            await family_approval.queue_approval(
                self.session,
                tx,
                protected,
                f"{mask_name(recipient.full_name)} · {mask_iban(recipient.iban)}",
            )
        if evaluation.decision is TransactionStatus.APPROVED:
            await upsert_transfer_edge(
                self.session, sender.id, recipient.id, ctx.amount, received_at
            )
            self.session.add(ProjectionEvent(transaction_id=tx.id, created_at=received_at))
        if refund is not None:
            await self.session.flush()
            refund.refund_transaction_id = tx.id
            self.session.add(refund)
        await self.session.commit()
        if evaluation.decision is TransactionStatus.APPROVED:
            await self.engine.ensure_consistent()
        return response

    @staticmethod
    def evaluation_response(
        tx: Transaction, ev: Evaluation, recipient: Account
    ) -> TransferEvaluateResponse:
        rg = ev.recipient_graph
        return TransferEvaluateResponse(
            transaction_id=tx.id,
            created_at=tx.created_at,
            updated_at=tx.updated_at,
            status=ev.decision,
            risk_score=ev.score,
            ml_score=ev.ml_score,
            ml_base_score=ev.ml_base_score,
            ml_model_version=ev.ml_model_version,
            ml_explanation_method=ev.ml_explanation_method,
            ml_contributors=[
                MLContributorOut(
                    feature=c.feature,
                    value=c.value,
                    contribution=round(c.contribution, 4),
                    label_kk=c.label_kk,
                    label_ru=c.label_ru,
                )
                for c in ev.ml_contributors
            ],
            headline_kk=ev.headline_kk,
            headline_ru=ev.headline_ru,
            reasons=risk_reasons(tx),
            reasons_kk=ev.reasons_kk,
            reasons_ru=ev.reasons_ru,
            latency_ms=ev.latency_ms,
            layer_latency_ms=ev.layer_latency_ms,
            cooling_off_until=tx.cooling_until,
            is_new_recipient=ev.is_new_recipient,
            is_new_device=tx.is_new_device,
            recipient=PartyOut(
                id=recipient.id,
                display_name=mask_name(recipient.full_name),
                iban_masked=mask_iban(recipient.iban),
            ),
            velocity=ev.velocity.as_dict(),
            recipient_graph={
                "in_degree": rg.in_degree,
                "out_degree": rg.out_degree,
                "in_weight": round(rg.in_weight, 2),
                "out_weight": round(rg.out_weight, 2),
                "transit_ratio": round(rg.transit_ratio, 3),
                "shared_device_accounts": rg.shared_device_accounts,
                "flagged": rg.flagged,
                "suspected_mule": rg.suspected_mule,
            },
            amount=tx.amount,
            context=TransferContextIn.model_validate(tx.context_snapshot),
            server_time=datetime.now(UTC),
        )

    async def resolve_cooling(
        self, tx_id: uuid.UUID, answers: CoolingQuestionnaire, *, save_only: bool = False
    ) -> TransferEvaluateResponse:
        await self.engine.ensure_consistent()
        async with self._serialized(tx_id):
            # Match evaluate's sender-before-row ordering. In particular, never
            # hold the source transaction while waiting behind a queued SOC
            # account writer: an in-flight retry may already share-lock that
            # account and be about to read this transaction as its hold anchor.
            sender_id = await self.session.scalar(
                select(Transaction.sender_id).where(Transaction.id == tx_id)
            )
            if sender_id is None:
                raise NotFoundError(f"transaction {tx_id} not found")
            await serialize_sender(self.session, sender_id)
            # The scalar lookup deliberately does not populate the identity map;
            # load the current lifecycle only after obtaining the sender lock.
            tx = await self._load(tx_id, locked=True)
            saved = answers.model_dump()
            if tx.status is not TransactionStatus.COOLING_OFF:
                if tx.resolution_action == "resolve" and tx.verification_answers == saved:
                    return transfer_detail(tx, tx.recipient)
                raise ConflictError(f"transaction is {tx.status.value}, not cooling_off")

            contact_suspicion = await self.session.scalar(
                select(
                    exists().where(
                        ContactNotification.transaction_id == tx.id,
                        ContactNotification.owner_id == tx.sender_id,
                        ContactNotification.state == NotificationState.SUSPICION,
                    )
                )
            )
            codes = {event.rule_code for event in tx.risk_events}
            if (
                not contact_suspicion
                and "POST_CALL_ENDED" in codes
                and "POST_CALL_RECOGNIZED" not in codes
            ):
                raise ConflictError("post_call_answer_required")
            now = datetime.now(UTC)
            flags = red_flags(answers, tx)
            blocking_score = BLOCKED_AFTER_RED_FLAG_SCORE
            # Refresh DB-held SOC flag at the final authorization boundary.
            await self.session.refresh(tx.recipient, with_for_update={"read": True})
            register_account(self.engine.graph, tx.recipient)
            if contact_suspicion:
                code = "TRUSTED_CONTACT_SUSPICION"
                kk, ru = explain.render(code)
                final_status = TransactionStatus.BLOCKED
            elif flags:
                kk = explain.REASONS["QUESTIONNAIRE_RED_FLAG"][0].format(
                    flags="; ".join(RED_FLAG_LABELS[f][0] for f in flags)
                )
                ru = explain.REASONS["QUESTIONNAIRE_RED_FLAG"][1].format(
                    flags="; ".join(RED_FLAG_LABELS[f][1] for f in flags)
                )
                code = "QUESTIONNAIRE_RED_FLAG"
                final_status = TransactionStatus.BLOCKED
            elif tx.recipient.is_flagged:
                kk, ru = explain.render("RECIPIENT_FLAGGED")
                code = "RECIPIENT_FLAGGED_AT_RELEASE"
                final_status = TransactionStatus.BLOCKED
            elif save_only or tx.cooling_until is None or now < tx.cooling_until:
                # A save submitted just before expiry may arrive after it.
                if tx.verification_answers != saved:
                    tx.verification_answers = saved
                    tx.updated_at = now
                    tx.risk_events.append(
                        RiskEvent(
                            layer=QUESTIONNAIRE_LAYER,
                            rule_code="QUESTIONNAIRE_VERIFIED",
                            score_delta=0,
                            reason_kk=(
                                "Жауаптар сақталды. Салқындату кезеңі аяқталған соң "
                                "аударымды қайта растаңыз."
                            ),
                            reason_ru=(
                                "Ответы сохранены. Подтвердите перевод после окончания "
                                "периода охлаждения."
                            ),
                            evidence={"answers": saved},
                            created_at=now,
                        )
                    )
                    await self.session.commit()
                return transfer_detail(tx, tx.recipient)
            else:
                recheck = await self._revalidate_release(tx, now)
                if recheck.decision is TransactionStatus.BLOCKED:
                    kk = "Қайта тексеру жаңа жоғары желілік тәуекелді анықтады. Аударым бұғатталды."
                    ru = "Повторная проверка выявила высокий сетевой риск. Перевод заблокирован."
                    code = "RELEASE_NETWORK_BLOCKED"
                    final_status = TransactionStatus.BLOCKED
                    blocking_score = recheck.score
                    for reason in recheck.reasons:
                        if reason.layer in {"velocity", "graph"} and reason.score_delta > 0:
                            tx.risk_events.append(
                                RiskEvent(
                                    layer="revalidation",
                                    rule_code=f"RECHECK_{reason.code}",
                                    score_delta=0,
                                    reason_kk=reason.reason_kk,
                                    reason_ru=reason.reason_ru,
                                    evidence=reason.evidence,
                                    created_at=now,
                                )
                            )
                else:
                    approval, deadline = await family_approval.approval_state(
                        self.session,
                        tx,
                        datetime.now(UTC),
                        required=family_approval.REQUIRED in codes,
                        releasing=True,
                    )
                    if deadline and datetime.now(UTC) >= deadline:
                        raise ConflictError("family_approval_expired")
                    if approval not in {"none", "confirmed"}:
                        raise ConflictError("family_approval_required")
                    await self._check_disputed_funds(
                        await self._get_account(tx.sender_id), tx.amount
                    )
                    # A completed hold and clean questionnaire may override behavioral
                    # friction, but never current hard-blocking network evidence.
                    kk, ru = explain.render("QUESTIONNAIRE_PASSED")
                    code = "QUESTIONNAIRE_PASSED"
                    final_status = TransactionStatus.APPROVED

            delta = (
                max(0, blocking_score - tx.risk_score)
                if final_status is TransactionStatus.BLOCKED
                else 0
            )
            tx.status = final_status
            tx.risk_score += delta
            tx.verification_answers = saved
            tx.resolution_action = "resolve"
            tx.resolved_at = now
            tx.updated_at = now
            tx.cooling_until = None
            tx.risk_events.append(
                RiskEvent(
                    layer=QUESTIONNAIRE_LAYER,
                    rule_code=code,
                    score_delta=delta,
                    reason_kk=kk,
                    reason_ru=ru,
                    evidence={"answers": saved, "red_flags": flags},
                    created_at=now,
                )
            )
            if tx.status is TransactionStatus.APPROVED:
                await upsert_transfer_edge(
                    self.session, tx.sender_id, tx.recipient_id, float(tx.amount), now
                )
                self.session.add(ProjectionEvent(transaction_id=tx.id, created_at=now))
            await self.session.commit()
            if tx.status is TransactionStatus.APPROVED:
                await self.engine.ensure_consistent()
            return transfer_detail(tx, tx.recipient)

    async def _revalidate_release(self, tx: Transaction, now: datetime) -> Evaluation:
        sender = await self._get_account(tx.sender_id)
        await self._refresh_device_peers(sender, tx.recipient, tx.device_id)
        original = TransferContextIn.model_validate(tx.context_snapshot or {})
        ctx = TransferContext(
            tx_id=str(tx.id),
            sender_id=str(tx.sender_id),
            recipient_id=str(tx.recipient_id),
            amount=float(tx.amount),
            device_id=tx.device_id,
            occurred_at=now,
            sender_avg_amount=float(sender.avg_tx_amount),
            active_call=tx.active_call,
            payment_requested_after_call=original.payment_requested_after_call,
            from_deposit=tx.from_deposit,
            is_new_device=tx.is_new_device,
            recipient_flagged=tx.recipient.is_flagged,
            pasted_recipient=original.pasted_recipient,
            duress=original.duress,
            typing_duration_ms=original.typing_duration_ms,
            hesitation_count=original.hesitation_count,
            recipient_input_length=original.recipient_input_length,
            hesitation_ms=original.hesitation_ms,
            # The bank's answer is part of the original evidence; the short-lived
            # check record may already have expired when the hold ends.
            bank_call_denied=any(e.rule_code == "BANK_CALL_DENIED" for e in tx.risk_events),
        )
        ctx = self.engine.trusted_context(ctx, known_device_id=sender.device_id)
        evaluation = await self.engine.evaluate(ctx, record_attempt=False)
        tx.risk_events.append(
            RiskEvent(
                layer="revalidation",
                rule_code="RELEASE_REVALIDATED",
                score_delta=0,
                reason_kk=f"Жіберу алдындағы қайта тексеру: тәуекел {evaluation.score}/100.",
                reason_ru=f"Повторная проверка перед отправкой: риск {evaluation.score}/100.",
                evidence={
                    "risk_score": evaluation.score,
                    "status": evaluation.decision.value,
                    "ml_score": evaluation.ml_score,
                    "ml_base_score": evaluation.ml_base_score,
                    "ml_model_version": evaluation.ml_model_version,
                    "ml_explanation_method": evaluation.ml_explanation_method,
                    "ml_contributors": [asdict(c) for c in evaluation.ml_contributors],
                    "reasons": [asdict(r) for r in evaluation.reasons],
                    "velocity": evaluation.velocity.as_dict(),
                    "recipient_graph": asdict(evaluation.recipient_graph),
                    "checked_at": now.isoformat(),
                },
                created_at=now,
            )
        )
        return evaluation

    async def record_post_call(
        self, tx_id: uuid.UUID, body: PostCallRequest
    ) -> TransferEvaluateResponse:
        code = "POST_CALL_ENDED" if body.action == "ended" else "POST_CALL_RECOGNIZED"
        async with self._serialized(tx_id):
            tx = await self._load(tx_id, locked=True)
            codes = {event.rule_code for event in tx.risk_events}
            if code in codes:
                return transfer_detail(tx, tx.recipient)
            if tx.status is not TransactionStatus.COOLING_OFF or not tx.active_call:
                raise ConflictError("post_call_unavailable")
            if body.action == "recognized" and "POST_CALL_ENDED" not in codes:
                raise ConflictError("call_end_required")
            _post_call_event(tx, code, datetime.now(UTC))
            await self.session.commit()
            return transfer_detail(tx, tx.recipient)

    async def cancel(
        self, tx_id: uuid.UUID, *, post_call_scam: bool = False
    ) -> TransferEvaluateResponse:
        # Cancellation only removes permission to execute. It needs the SQL lifecycle
        # lock, not Redis or delivery of unrelated approved-transfer projections.
        async with self._serialized(tx_id):
            tx = await self._load(tx_id, locked=True)
            codes = {event.rule_code for event in tx.risk_events}
            if post_call_scam and "POST_CALL_ENDED" not in codes:
                raise ConflictError("call_end_required")
            if tx.status is TransactionStatus.CANCELLED and tx.resolution_action == "cancel":
                if post_call_scam and "POST_CALL_SCAM_REPORTED" not in codes:
                    raise ConflictError("transaction_already_cancelled")
                return transfer_detail(tx, tx.recipient)
            if tx.status is not TransactionStatus.COOLING_OFF:
                raise ConflictError(f"transaction is {tx.status.value}, not cooling_off")
            now = datetime.now(UTC)
            tx.status = TransactionStatus.CANCELLED
            tx.resolution_action = "cancel"
            tx.resolved_at = now
            tx.updated_at = now
            tx.cooling_until = None
            tx.risk_events.append(
                RiskEvent(
                    layer=QUESTIONNAIRE_LAYER,
                    rule_code="CUSTOMER_CANCELLED",
                    score_delta=0,
                    reason_kk="Клиент аударымды тоқтатты. Қаражат жіберілген жоқ.",
                    reason_ru="Клиент отменил перевод. Средства не отправлены.",
                    evidence={},
                    created_at=now,
                )
            )
            if post_call_scam:
                _post_call_event(tx, "POST_CALL_SCAM_REPORTED", now)
            await self.session.commit()
            return transfer_detail(tx, tx.recipient)

    async def abandon(self, request_id: uuid.UUID) -> AbandonRequestResponse:
        # The durable no-execution promise must remain available during a scoring
        # outage. The same SQL lock as evaluate still decides which operation wins.
        async with self._serialized(request_id):
            existing = (
                await self.session.execute(
                    select(Transaction)
                    .where((Transaction.id == request_id) | (Transaction.request_id == request_id))
                    .options(
                        selectinload(Transaction.risk_events), selectinload(Transaction.recipient)
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                return AbandonRequestResponse(
                    request_id=request_id,
                    status="processed",
                    evaluation=transfer_detail(existing, existing.recipient),
                    server_time=datetime.now(UTC),
                )
            if await self.session.get(AbandonedRequest, request_id) is None:
                self.session.add(AbandonedRequest(request_id=request_id))
                await self.session.commit()
            return AbandonRequestResponse(
                request_id=request_id, status="abandoned", server_time=datetime.now(UTC)
            )


async def hydrate_graph(
    session: AsyncSession, graph: GraphStore, *, include_observed_devices: bool = True
) -> None:
    """Rebuild the resident money-flow graph from Postgres at startup."""
    for acc_id, name, device, flagged, flag_version in await session.execute(
        select(
            Account.id,
            Account.full_name,
            Account.device_id,
            Account.is_flagged,
            Account.flag_version,
        )
    ):
        graph.add_account(
            str(acc_id), label=name, device_id=device, flagged=flagged, flag_version=flag_version
        )
    edges = await session.execute(
        select(
            GraphEdge.source_id,
            GraphEdge.target_id,
            GraphEdge.edge_type,
            GraphEdge.weight,
            GraphEdge.tx_count,
            GraphEdge.last_seen_at,
        )
    )
    for src, dst, edge_type, weight, count, seen in edges:
        if edge_type is EdgeType.TRANSFER:
            graph.add_transfer(str(src), str(dst), weight, tx_count=count, ts=seen.timestamp())
        else:
            link = f"link:{min(str(src), str(dst))}:{max(str(src), str(dst))}"
            graph.link_device(str(src), link)
            graph.link_device(str(dst), link)
    if include_observed_devices:
        devices = await session.execute(
            select(Transaction.sender_id, Transaction.device_id).distinct()
        )
        for sender_id, device_id in devices:
            graph.link_device(str(sender_id), device_id)

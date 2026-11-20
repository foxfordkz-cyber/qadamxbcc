"""Transfer orchestration: resolve parties → score → persist → update graph."""

import asyncio
import hashlib
import json
import uuid
from collections import Counter
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from weakref import WeakKeyDictionary

from sqlalchemy import Connection, Engine, case, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ml.model import MODEL_VERSION
from app.models import (
    AbandonedRequest,
    Account,
    EdgeType,
    GraphEdge,
    ProjectionEvent,
    RiskEvent,
    Transaction,
    TransactionStatus,
)
from app.schemas.transfers import (
    AbandonRequestResponse,
    CoolingQuestionnaire,
    MLContributorOut,
    PartyOut,
    RiskReasonOut,
    TransferContextIn,
    TransferEvaluateRequest,
    TransferEvaluateResponse,
)
from app.services import explain
from app.services.antifraud import AntifraudEngine, Evaluation, TransferContext
from app.services.call_check import CallCheckService
from app.services.graph import MAX_GRAPH_NEIGHBOURS, GraphCapacityError, GraphStore

QUESTIONNAIRE_LAYER = "questionnaire"
BLOCKED_AFTER_RED_FLAG_SCORE = 90
_SQLITE_LOCKS: WeakKeyDictionary[Engine, asyncio.Lock] = WeakKeyDictionary()

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
        "қоңырау не депозиттен алу кезінде клиент алушыны жеке танымайтынын растады",
        "клиент не знает получателя лично при звонке или выводе средств с депозита",
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


def red_flags(
    answers: CoolingQuestionnaire, *, active_call: bool = False, from_deposit: bool = False
) -> list[str]:
    flags: list[str] = []
    if answers.caller_claims_bank_or_police:
        flags.append("caller_claims_bank_or_police")
    if answers.asked_to_move_to_safe_account:
        flags.append("asked_to_move_to_safe_account")
    if answers.asked_to_keep_secret_or_install_app:
        flags.append("asked_to_keep_secret_or_install_app")
    if not answers.initiated_by_customer:
        flags.append("initiated_by_customer")
    if not answers.knows_recipient_personally and (active_call or from_deposit):
        flags.append("unknown_recipient_under_pressure")
    return flags


def register_account(graph: GraphStore, account: Account) -> None:
    """Sync an account's label, home device and SOC flag into the resident graph."""
    graph.add_account(
        str(account.id),
        label=account.full_name,
        device_id=account.device_id,
        flagged=account.is_flagged,
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
            evidence=e.evidence or {},
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
        else explain.headline(tx.status, minutes=minutes)
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
        red_flags=red_flags(
            CoolingQuestionnaire.model_validate(tx.verification_answers),
            active_call=tx.active_call,
            from_deposit=tx.from_deposit,
        )
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
        bind = self.session.get_bind()
        if bind.dialect.name == "postgresql":
            key = int.from_bytes(hashlib.sha256(identity.bytes).digest()[:8], "big", signed=True)
            await self.session.execute(select(func.pg_advisory_xact_lock(key)))
            yield
        else:
            # SQLite tests share one connection: serialize the transaction, including commit.
            engine = bind.engine if isinstance(bind, Connection) else bind
            lock = _SQLITE_LOCKS.setdefault(engine, asyncio.Lock())
            async with lock:
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
        account = await self.session.get(Account, account_id)
        if account is None:
            raise NotFoundError(f"account {account_id} not found")
        return account

    async def _resolve_recipient(self, req: TransferEvaluateRequest) -> Account:
        if req.recipient_id is not None:
            return await self._get_account(req.recipient_id)
        stmt = select(Account)
        if req.recipient_phone is not None:
            stmt = stmt.where(Account.phone == req.recipient_phone)
        else:
            stmt = stmt.where(Account.iban == req.recipient_iban)
        account = (await self.session.execute(stmt)).scalar_one_or_none()
        if account is None:
            raise NotFoundError("recipient not found")
        return account

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
        await self.engine.ensure_consistent()
        identity = req.request_id or uuid.uuid4()
        async with self._serialized(identity):
            payload = req.model_dump(mode="json", exclude={"request_id"})
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
            return await self._evaluate(req, identity, request_hash)

    async def _evaluate(
        self, req: TransferEvaluateRequest, tx_id: uuid.UUID, request_hash: str
    ) -> TransferEvaluateResponse:
        sender = await self._get_account(req.sender_id)
        recipient = await self._resolve_recipient(req)
        if sender.id == recipient.id:
            raise InvalidTransferError("sender and recipient must differ")

        device_id = req.device_id or sender.device_id
        await self._refresh_device_peers(sender, recipient, device_id)

        is_new_device = (
            req.context.is_new_device
            if req.context.is_new_device is not None
            else device_id != sender.device_id
        )
        occurred_at = (req.occurred_at or datetime.now(UTC)).astimezone(UTC)
        ctx = TransferContext(
            tx_id=str(tx_id),
            sender_id=str(sender.id),
            recipient_id=str(recipient.id),
            amount=float(req.amount),
            device_id=device_id,
            occurred_at=occurred_at,
            sender_avg_amount=float(sender.avg_tx_amount),
            active_call=req.context.active_call,
            from_deposit=req.context.from_deposit,
            is_new_device=is_new_device,
            is_new_recipient=req.context.is_new_recipient,
            pasted_recipient=req.context.pasted_recipient,
            duress=req.context.duress,
            typing_duration_ms=req.context.typing_duration_ms,
            hesitation_count=req.context.hesitation_count,
            recipient_input_length=req.context.recipient_input_length,
            hesitation_ms=req.context.hesitation_ms,
            bank_call_denied=await CallCheckService(self.engine.redis).denied_for(
                req.context.bank_call_check_id, sender.id
            ),
        )
        ctx = self.engine.trusted_context(ctx, known_device_id=sender.device_id)

        evaluation = await self.engine.evaluate(ctx)

        received_at = datetime.now(UTC)
        cooling_until = (
            received_at + timedelta(minutes=evaluation.cooling_off_minutes)
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
            device_id=device_id,
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
        response = self._evaluation_response(tx, evaluation, recipient)
        tx.evaluation_snapshot = response.model_dump(mode="json")
        self.session.add(tx)
        if evaluation.decision is TransactionStatus.APPROVED:
            await upsert_transfer_edge(
                self.session, sender.id, recipient.id, ctx.amount, received_at
            )
            self.session.add(ProjectionEvent(transaction_id=tx.id, created_at=received_at))
        await self.session.commit()
        if evaluation.decision is TransactionStatus.APPROVED:
            await self.engine.ensure_consistent()
        return response

    def _evaluation_response(
        self, tx: Transaction, ev: Evaluation, recipient: Account
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
            ml_model_version=MODEL_VERSION,
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
        self, tx_id: uuid.UUID, answers: CoolingQuestionnaire
    ) -> TransferEvaluateResponse:
        await self.engine.ensure_consistent()
        async with self._serialized(tx_id):
            tx = await self._load(tx_id, locked=True)
            saved = answers.model_dump()
            if tx.status is not TransactionStatus.COOLING_OFF:
                if tx.resolution_action == "resolve" and tx.verification_answers == saved:
                    return transfer_detail(tx, tx.recipient)
                raise ConflictError(f"transaction is {tx.status.value}, not cooling_off")

            now = datetime.now(UTC)
            flags = red_flags(answers, active_call=tx.active_call, from_deposit=tx.from_deposit)
            blocking_score = BLOCKED_AFTER_RED_FLAG_SCORE
            # Refresh DB-held SOC flag at the final authorization boundary.
            await self.session.refresh(tx.recipient)
            register_account(self.engine.graph, tx.recipient)
            if flags:
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
            elif tx.cooling_until is None or now < tx.cooling_until:
                # Answers may be saved early; money never moves just because the timer ends.
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
            from_deposit=tx.from_deposit,
            is_new_device=tx.is_new_device,
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
                    "ml_model_version": MODEL_VERSION,
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

    async def cancel(self, tx_id: uuid.UUID) -> TransferEvaluateResponse:
        # Cancellation only removes permission to execute. It needs the SQL lifecycle
        # lock, not Redis or delivery of unrelated approved-transfer projections.
        async with self._serialized(tx_id):
            tx = await self._load(tx_id, locked=True)
            if tx.status is TransactionStatus.CANCELLED and tx.resolution_action == "cancel":
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
    for acc_id, name, device, flagged in await session.execute(
        select(Account.id, Account.full_name, Account.device_id, Account.is_flagged)
    ):
        graph.add_account(str(acc_id), label=name, device_id=device, flagged=flagged)
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

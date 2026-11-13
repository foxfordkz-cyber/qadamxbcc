"""Transfer orchestration: resolve parties → score → persist → update graph."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Account, EdgeType, GraphEdge, RiskEvent, Transaction, TransactionStatus
from app.schemas.transfers import CoolingQuestionnaire, TransferEvaluateRequest
from app.services import explain
from app.services.antifraud import AntifraudEngine, Evaluation, TransferContext
from app.services.graph import GraphStore

QUESTIONNAIRE_LAYER = "questionnaire"
BLOCKED_AFTER_RED_FLAG_SCORE = 90

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
}


class DomainError(Exception):
    """Base error mapped to an HTTP status by the API layer."""


class NotFoundError(DomainError):
    pass


class ConflictError(DomainError):
    pass


class InvalidTransferError(DomainError):
    pass


@dataclass(frozen=True, slots=True)
class EvaluatedTransfer:
    transaction: Transaction
    evaluation: Evaluation
    recipient: Account


@dataclass(frozen=True, slots=True)
class ResolvedCooling:
    transaction: Transaction
    red_flags: list[str]
    reasons_kk: list[str]
    reasons_ru: list[str]
    headline_kk: str
    headline_ru: str


def mask_name(full_name: str) -> str:
    parts = full_name.split()
    if len(parts) < 2:
        return full_name
    return f"{parts[0]} {parts[1][0]}."


def mask_iban(iban: str) -> str:
    return f"{iban[:2]}** •••• {iban[-4:]}"


def red_flags(answers: CoolingQuestionnaire) -> list[str]:
    flags: list[str] = []
    if answers.caller_claims_bank_or_police:
        flags.append("caller_claims_bank_or_police")
    if answers.asked_to_move_to_safe_account:
        flags.append("asked_to_move_to_safe_account")
    if answers.asked_to_keep_secret_or_install_app:
        flags.append("asked_to_keep_secret_or_install_app")
    if not answers.initiated_by_customer:
        flags.append("initiated_by_customer")
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
    edge = (
        await session.execute(
            select(GraphEdge).where(
                GraphEdge.source_id == source,
                GraphEdge.target_id == target,
                GraphEdge.edge_type == EdgeType.TRANSFER,
            )
        )
    ).scalar_one_or_none()
    if edge is None:
        session.add(
            GraphEdge(
                source_id=source,
                target_id=target,
                edge_type=EdgeType.TRANSFER,
                weight=amount,
                tx_count=1,
                last_seen_at=at,
            )
        )
    else:
        edge.weight += amount
        edge.tx_count += 1
        edge.last_seen_at = max(edge.last_seen_at, at)


class TransferService:
    def __init__(self, session: AsyncSession, engine: AntifraudEngine) -> None:
        self.session = session
        self.engine = engine

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

    async def evaluate(self, req: TransferEvaluateRequest) -> EvaluatedTransfer:
        sender = await self._get_account(req.sender_id)
        recipient = await self._resolve_recipient(req)
        if sender.id == recipient.id:
            raise InvalidTransferError("sender and recipient must differ")

        device_id = req.device_id or sender.device_id
        # The resident graph only knows accounts hydrated at startup. Sync both parties and
        # every account sharing a relevant device (indexed lookup) so device-cluster rules
        # also see accounts created while the service is running.
        register_account(self.engine.graph, sender)
        register_account(self.engine.graph, recipient)
        device_peers = await self.session.execute(
            select(Account).where(Account.device_id.in_({recipient.device_id, device_id}))
        )
        for peer in device_peers.scalars():
            register_account(self.engine.graph, peer)

        is_new_device = (
            req.context.is_new_device
            if req.context.is_new_device is not None
            else device_id != sender.device_id
        )
        occurred_at = (req.occurred_at or datetime.now(UTC)).astimezone(UTC)
        tx_id = uuid.uuid4()
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
        )

        evaluation = await self.engine.evaluate(ctx)

        received_at = datetime.now(UTC)
        cooling_until = (
            received_at + timedelta(minutes=evaluation.cooling_off_minutes)
            if evaluation.decision is TransactionStatus.COOLING_OFF
            else None
        )
        tx = Transaction(
            id=tx_id,
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
            is_new_device=is_new_device,
            is_new_recipient=evaluation.is_new_recipient,
            cooling_until=cooling_until,
            created_at=received_at,
        )
        tx.risk_events = [
            RiskEvent(
                layer=r.layer,
                rule_code=r.code,
                score_delta=r.score_delta,
                reason_kk=r.reason_kk,
                reason_ru=r.reason_ru,
                created_at=received_at,
            )
            for r in evaluation.reasons
        ]
        self.session.add(tx)
        if evaluation.decision is TransactionStatus.APPROVED:
            await upsert_transfer_edge(
                self.session, sender.id, recipient.id, ctx.amount, received_at
            )
        await self.session.commit()
        if evaluation.decision is TransactionStatus.APPROVED:
            self.engine.apply_transfer(ctx)
        return EvaluatedTransfer(transaction=tx, evaluation=evaluation, recipient=recipient)

    async def resolve_cooling(
        self, tx_id: uuid.UUID, answers: CoolingQuestionnaire
    ) -> ResolvedCooling:
        tx = (
            await self.session.execute(
                select(Transaction)
                .where(Transaction.id == tx_id)
                .options(selectinload(Transaction.risk_events))
                .with_for_update()
            )
        ).scalar_one_or_none()
        if tx is None:
            raise NotFoundError(f"transaction {tx_id} not found")
        if tx.status is not TransactionStatus.COOLING_OFF:
            raise ConflictError(f"transaction is {tx.status.value}, not cooling_off")

        now = datetime.now(UTC)
        flags = red_flags(answers)
        if flags:
            flags_kk = "; ".join(RED_FLAG_LABELS[f][0] for f in flags)
            flags_ru = "; ".join(RED_FLAG_LABELS[f][1] for f in flags)
            kk = explain.REASONS["QUESTIONNAIRE_RED_FLAG"][0].format(flags=flags_kk)
            ru = explain.REASONS["QUESTIONNAIRE_RED_FLAG"][1].format(flags=flags_ru)
            delta = max(0, BLOCKED_AFTER_RED_FLAG_SCORE - tx.risk_score)
            tx.status = TransactionStatus.BLOCKED
            tx.risk_score = max(tx.risk_score, BLOCKED_AFTER_RED_FLAG_SCORE)
            event = RiskEvent(
                layer=QUESTIONNAIRE_LAYER,
                rule_code="QUESTIONNAIRE_RED_FLAG",
                score_delta=delta,
                reason_kk=kk,
                reason_ru=ru,
                created_at=now,
            )
        else:
            kk, ru = explain.render("QUESTIONNAIRE_PASSED")
            tx.status = TransactionStatus.APPROVED
            event = RiskEvent(
                layer=QUESTIONNAIRE_LAYER,
                rule_code="QUESTIONNAIRE_PASSED",
                score_delta=0,
                reason_kk=kk,
                reason_ru=ru,
                created_at=now,
            )
            await upsert_transfer_edge(
                self.session, tx.sender_id, tx.recipient_id, float(tx.amount), now
            )
        tx.risk_events.append(event)
        tx.resolved_at = now
        await self.session.commit()

        if tx.status is TransactionStatus.APPROVED:
            self.engine.graph.add_transfer(
                str(tx.sender_id), str(tx.recipient_id), float(tx.amount), ts=now.timestamp()
            )
        head_kk, head_ru = explain.headline(tx.status, minutes=self.engine.cooling_off_minutes)
        return ResolvedCooling(
            transaction=tx,
            red_flags=flags,
            reasons_kk=[kk],
            reasons_ru=[ru],
            headline_kk=head_kk,
            headline_ru=head_ru,
        )


async def hydrate_graph(session: AsyncSession, graph: GraphStore) -> None:
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
    devices = await session.execute(select(Transaction.sender_id, Transaction.device_id).distinct())
    for sender_id, device_id in devices:
        graph.link_device(str(sender_id), device_id)

"""Add the wallet-v1 examples inside the private handoff Compose project."""

import argparse
import asyncio
import json
import os
from collections import Counter
from datetime import timedelta
from decimal import Decimal
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.base import utcnow
from app.db.session import build_engine
from app.integrations.audit import record
from app.integrations.capabilities import Principal
from app.integrations.cases import service
from app.integrations.cases.models import CaseEvent, FraudCase
from app.integrations.cases.schemas import (
    AnswerInformation,
    AskInformation,
    Assign,
    Note,
    State,
    Transition,
)
from app.integrations.guardian_reports import Category, ReportRequest, create_report
from app.integrations.models import GuardianReport, TrustedContact
from app.mobile_gateway.demo_catalog import PACK, key
from app.models import Account, GraphEdge, Transaction, TransactionStatus
from app.models.entities import EdgeType
from app.schemas.transfers import TransferContextIn
from app.services.antifraud import AntifraudEngine, TransferContext
from app.services.transfers import TransferService
from scripts.seed_bcc import FRIEND_ID, HUB_ID, SENDER_ID, STRANGER_ID, _risk_events

DESCRIPTIONS: tuple[tuple[Category, str], ...] = (
    ("impersonation", "Демо: звонивший представился сотрудником. Прошу проверить операцию."),
    ("safe_account", "Демо: попросили срочно перевести деньги на защищённый счёт."),
    ("remote_access", "Демо: собеседник предложил установить программу для помощи."),
    ("other", "Демо: получатель знаком. Прошу уточнить основание для проверки."),
)


# These three closed investigations have independently authored teaching outcomes.
# All risk scores are computed when the history room is created.
REVIEW_OUTCOMES: dict[int, Literal["confirmed_fraud", "legitimate_transfer"]] = {
    1: "confirmed_fraud",
    4: "legitimate_transfer",
    7: "legitimate_transfer",
}


async def record_history_evaluation(
    engine: AntifraudEngine, index: int, tx: Transaction, sender: Account, recipient: Account
) -> None:
    context = TransferContextIn(
        active_call=index == 1,
        from_deposit=index == 4,
        is_new_recipient=index == 4,
    )
    evaluation = await engine.evaluate(
        TransferContext(
            tx_id=str(tx.id),
            sender_id=str(sender.id),
            recipient_id=str(recipient.id),
            amount=float(tx.amount),
            sender_avg_amount=float(sender.avg_tx_amount),
            device_id=sender.device_id,
            occurred_at=tx.created_at,
            active_call=context.active_call,
            from_deposit=context.from_deposit,
            is_new_recipient=context.is_new_recipient,
        ),
        record_attempt=False,
    )
    if evaluation.decision != TransactionStatus.APPROVED:
        raise ValueError("The archived posted transfer no longer matches its original approval")
    tx.context_snapshot = context.model_dump(mode="json")
    tx.active_call = context.active_call
    tx.from_deposit = context.from_deposit
    tx.is_new_device = False
    tx.is_new_recipient = evaluation.is_new_recipient
    tx.risk_score = evaluation.score
    tx.latency_ms = evaluation.latency_ms
    tx.risk_events = _risk_events(evaluation, tx.created_at)
    tx.evaluation_snapshot = TransferService.evaluation_response(
        tx, evaluation, recipient
    ).model_dump(mode="json")


async def populate(
    db: AsyncSession, *, review_engine: AntifraudEngine | None = None
) -> dict[str, object]:
    first = await db.get(Transaction, key("out/0"))
    if first:
        return {
            "added": 0,
            "already_applied": True,
            "first_operation": str(first.id),
            "anchor": (first.created_at + timedelta(hours=1)).isoformat(),
            "delta_by_account": {},
        }
    owner = await db.get(Account, SENDER_ID)
    peers = list(
        await db.scalars(
            select(Account)
            .where(
                Account.id.not_in([SENDER_ID, FRIEND_ID, STRANGER_ID, HUB_ID]),
                Account.is_flagged.is_(False),
            )
            .order_by(Account.id)
            .limit(12)
        )
    )
    if owner is None or len(peers) < 12:
        raise RuntimeError("Initialize the isolated synthetic stand before adding wallet-v1")
    anchor = utcnow().replace(microsecond=0)
    deltas: Counter[str] = Counter()
    edges: dict[tuple[UUID, UUID], GraphEdge] = {}
    pairs = []
    for i in range(20):
        peer = peers[i % len(peers)]
        amount = Decimal(1350 + 725 * i)
        at = anchor - timedelta(
            days=(0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 17, 21, 25, 29, 33, 41, 52, 60, 72, 86)[i],
            hours=1,
        )
        if review_engine is not None and i in REVIEW_OUTCOMES:
            # Fix the local time of these examples at noon in Kazakhstan.
            at = at.replace(hour=7, minute=0, second=0)
        group = []
        for direction, sender, recipient in (("out", owner, peer), ("in", peer, owner)):
            when = at + timedelta(minutes=int(direction == "in"))
            tx = Transaction(
                id=key(f"{direction}/{i}"),
                sender_id=sender.id,
                recipient_id=recipient.id,
                device_id=sender.device_id,
                amount=amount,
                status=TransactionStatus.APPROVED,
                created_at=when,
                updated_at=when,
                resolved_at=when,
            )
            if (
                review_engine is not None
                and i in REVIEW_OUTCOMES
                and direction == ("out" if i < 4 else "in")
            ):
                await record_history_evaluation(review_engine, i, tx, sender, recipient)
            db.add(tx)
            group.append(tx)
            deltas[str(sender.id)] -= int(amount)
            deltas[str(recipient.id)] += int(amount)
            edge_key = (sender.id, recipient.id)
            if edge_key not in edges:
                edge = await db.scalar(
                    select(GraphEdge).where(
                        GraphEdge.source_id == sender.id,
                        GraphEdge.target_id == recipient.id,
                        GraphEdge.edge_type == EdgeType.TRANSFER,
                    )
                )
                if edge is None:
                    edge = GraphEdge(
                        id=key(f"edge/{sender.id}/{recipient.id}"),
                        source_id=sender.id,
                        target_id=recipient.id,
                        edge_type=EdgeType.TRANSFER,
                        tx_count=0,
                        weight=0,
                        last_seen_at=when,
                    )
                    db.add(edge)
                edges[edge_key] = edge
            edge = edges[edge_key]
            edge.tx_count += 1
            edge.weight += float(amount)
            edge.last_seen_at = max(edge.last_seen_at, when)
        pairs.append(group)
    await db.flush()
    if any(deltas.values()):
        raise RuntimeError("Unbalanced fixture postings")
    soc = Principal(subject=UUID("00000000-0000-4000-8000-000000000099"), role="soc")
    for i in range(10):
        tx = pairs[i][int(i >= 4)]
        category, description = DESCRIPTIONS[i % 4]
        if review_engine is not None and i == 4:
            category, description = (
                "other",
                "Демо: клиент сам перевёл деньги с депозита новому получателю.",
            )
        report = await create_report(
            db,
            tx.sender_id,
            ReportRequest(
                category=category,
                description=description,
                transaction_id=tx.id,
                confirmed_demo_submission=True,
            ),
            key(f"report/{i}"),
        )
        if i % 3 == 1:
            report.state = "DEMO_ACKNOWLEDGED"
            record(db, report.owner_id, report.id, report.id, "GUARDIAN_REPORT_DEMO_ACKNOWLEDGED")
        case = await service.open_case(db, report.id, soc, key(f"open/{i}"), report.content_hash)
        if i == 3:
            continue
        mutations: list[Assign | Transition | Note | AskInformation] = [
            Assign(action="assign", expected_version=1, assignee="demo_analyst_a"),
            Transition(
                action="transition", expected_version=2, state="IN_REVIEW", reason="review_started"
            ),
            Note(
                action="note",
                expected_version=3,
                body="Демо: сверены получатель и сумма по учебной квитанции.",
            ),
        ]
        if i % 3 == 0:
            mutations.append(
                AskInformation(
                    action="request_information", expected_version=4, question="caller_request"
                )
            )
        else:
            next_state: State = "CLOSED" if i % 3 == 1 else "ESCALATED"
            mutations.append(
                Transition(
                    action="transition",
                    expected_version=4,
                    state=next_state,
                    reason=(
                        REVIEW_OUTCOMES[i]
                        if review_engine is not None and i in REVIEW_OUTCOMES
                        else "review_complete"
                        if next_state == "CLOSED"
                        else "needs_followup"
                    ),
                )
            )
        for step, action in enumerate(mutations):
            await service.mutate(db, case.id, soc, key(f"action/{i}/{step}"), action)
        if i == 0:
            question = await db.scalar(
                select(CaseEvent).where(
                    CaseEvent.case_id == case.id, CaseEvent.code == "REQUEST_INFORMATION"
                )
            )
            row = await db.get(FraudCase, case.id)
            if question is None or row is None:
                raise RuntimeError("Missing fixture case or information request")
            await service.answer(
                db,
                row,
                question.id,
                Principal(role="owner", subject=tx.sender_id),
                key("answer/0"),
                AnswerInformation(
                    body="Демо: звонивший торопил и просил скрыть перевод.",
                    confirmed_demo_submission=True,
                ),
            )
    contact_count = await db.scalar(
        select(func.count()).select_from(TrustedContact).where(TrustedContact.owner_id == owner.id)
    )
    added_contacts = 0
    for i, state in enumerate(("CONTACT_PENDING_CONSENT", "CONTACT_REVOKED", "CONTACT_VERIFIED")):
        if (contact_count or 0) + added_contacts >= 3:
            break
        db.add(
            TrustedContact(
                id=key(f"contact/{i}"),
                owner_id=owner.id,
                alias=("Демо · Аға", "Демо · Друг", "Демо · Әпке")[i],
                language=("kk", "ru", "kk")[i],
                state=state,
                notifications_enabled=False,
                created_at=anchor,
                owner_consented_at=anchor,
                contact_consented_at=anchor if i == 2 else None,
                invitation_expires_at=anchor + timedelta(days=1),
            )
        )
        added_contacts += 1
    await db.flush()
    return {
        "added": 40,
        "operations": 40,
        "reports": 10,
        "cases": 10,
        "contacts": added_contacts,
        "anchor": anchor.isoformat(),
        "delta_by_account": dict(deltas),
    }


def target_database() -> str:
    cfg = get_settings()
    url = make_url(cfg.database_url)
    if not (
        cfg.environment == "demo"
        and os.environ.get("BCC_HANDOFF_DATASET") == PACK
        and os.environ.get("BCC_INTEGRATIONS_TELEGRAM_MODE") == "fake"
        and url.drivername == "postgresql+asyncpg"
        and url.host == "postgres"
        and url.database == "qadam_handoff"
    ):
        raise SystemExit("Expected private qadam-handoff Compose database and fake adapter")
    return cfg.database_url


async def main(apply: bool) -> None:
    database = target_database()
    engine = build_engine(database)
    try:
        async with engine.connect() as conn:
            outer = await conn.begin()
            await conn.execute(text("SELECT pg_advisory_xact_lock(143807129)"))
            async with AsyncSession(
                bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
            ) as session:
                baseline = {
                    model.__tablename__: await session.scalar(
                        select(func.count()).select_from(model)
                    )
                    for model in (Account, Transaction, GuardianReport, FraudCase)
                }
                plan = await populate(session)
                await session.commit()
            if apply:
                await outer.commit()
            else:
                await outer.rollback()
            print(
                json.dumps(
                    {
                        "dataset": PACK,
                        "applied": apply,
                        "target": make_url(database).database,
                        "before": baseline,
                        **plan,
                    }
                )
            )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Commit; default is rollback preview")
    asyncio.run(main(parser.parse_args().apply))

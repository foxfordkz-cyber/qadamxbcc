"""One feasible allocation of an approved amount through strictly later settled transfers.

Uses the SQL history at a fixed observation cutoff, independent of the risk scorer.
It does not infer ownership of fungible funds or add up the same money across hops.
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from itertools import groupby
from operator import attrgetter

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from app.db.base import utcnow
from app.models import Transaction, TransactionStatus
from app.schemas.funds_trace import FundsTrace, TracedTransfer

MAX_HOPS = 3
MAX_CANDIDATES = 160
WINDOW_HOURS = 24
ZERO = Decimal("0.00")


@dataclass(frozen=True, slots=True)
class Movement:
    id: uuid.UUID
    sender: uuid.UUID
    recipient: uuid.UUID
    amount: Decimal
    settled_at: datetime


async def _candidates(
    session: AsyncSession, anchor: Movement, currency: str, cutoff: datetime
) -> tuple[list[Movement], bool]:
    settled = func.coalesce(Transaction.resolved_at, Transaction.created_at)
    frontier = {anchor.recipient}
    visited: set[uuid.UUID] = set()
    candidates: list[Movement] = []
    for _ in range(MAX_HOPS):
        if not frontier:
            break
        remaining = MAX_CANDIDATES - len(candidates)
        rows = (
            await session.execute(
                select(
                    Transaction.id,
                    Transaction.sender_id,
                    Transaction.recipient_id,
                    Transaction.amount,
                    settled,
                )
                .where(
                    Transaction.sender_id.in_(frontier),
                    Transaction.status == TransactionStatus.APPROVED,
                    Transaction.currency == currency,
                    Transaction.id != anchor.id,
                    Transaction.sender_id != Transaction.recipient_id,
                    settled >= anchor.settled_at,
                    settled <= cutoff,
                )
                .order_by(settled, Transaction.id)
                .limit(remaining + 1)
            )
        ).all()
        tranche = [Movement(*row) for row in rows[:remaining]]
        if len(rows) > remaining:
            # Do not allocate to an arbitrary subset of simultaneous outflows.
            next_time = rows[-1][4]
            candidates.extend(item for item in tranche if item.settled_at < next_time)
            return candidates, True
        candidates.extend(tranche)
        visited.update(frontier)
        frontier = {item.recipient for item in tranche} - visited
    return candidates, False


def _empty_balance() -> list[Decimal]:
    return [ZERO] * MAX_HOPS


def allocate(anchor: Movement, candidates: Iterable[Movement], report: FundsTrace) -> None:
    balances: dict[uuid.UUID, list[Decimal]] = defaultdict(_empty_balance)
    balances[anchor.recipient][0] = anchor.amount
    ordered = sorted(candidates, key=attrgetter("settled_at", "id"))
    for instant, simultaneous in groupby(ordered, key=attrgetter("settled_at")):
        outgoing: dict[uuid.UUID, list[Movement]] = defaultdict(list)
        for item in simultaneous:
            outgoing[item.sender].append(item)
        if instant == anchor.settled_at:
            report.ambiguous_count += len(outgoing.get(anchor.recipient, []))
            continue
        # Only balances from *earlier* instants can be spent in this whole group.
        incoming: dict[uuid.UUID, list[Decimal]] = defaultdict(_empty_balance)
        allocated: dict[uuid.UUID, Decimal] = {}
        ambiguous: set[uuid.UUID] = set()
        for sender, payments in outgoing.items():
            available = balances[sender]
            total = sum(available, ZERO)
            if total <= 0:
                continue
            if len(payments) > 1 and sum((p.amount for p in payments), ZERO) > total:
                # Several recipients compete for the same source budget. Its destination
                # is unresolved, so reserve it from all subsequent allocations.
                ambiguous.update(p.id for p in payments)
                balances[sender] = _empty_balance()
                continue
            for payment in payments:
                left = payment.amount
                hops: list[int] = []
                for depth, balance in enumerate(available):
                    part = min(balance, left)
                    if not part:
                        continue
                    available[depth] -= part
                    left -= part
                    hops.append(depth + 1)
                    if depth == 0:
                        report.first_hop_amount += part
                    if depth + 1 < MAX_HOPS:
                        incoming[payment.recipient][depth + 1] += part
                if hops:
                    allocated[payment.id] = payment.amount - left
                    report.links.append(
                        TracedTransfer(
                            transaction_id=payment.id,
                            sender_id=sender,
                            recipient_id=payment.recipient,
                            settled_at=instant,
                            transaction_amount=payment.amount,
                            allocated_amount=allocated[payment.id],
                            first_hop=min(hops),
                            last_hop=max(hops),
                        )
                    )
        for recipient, credits in incoming.items():
            for payment in outgoing.get(recipient, []):
                if allocated.get(payment.id, ZERO) < payment.amount:
                    ambiguous.add(payment.id)
            for depth, credit in enumerate(credits):
                balances[recipient][depth] += credit
        report.ambiguous_count += len(ambiguous)


async def funds_trace(
    session: AsyncSession, transaction_id: uuid.UUID, *, as_of: datetime | None = None
) -> FundsTrace | None:
    tx = await session.get(
        Transaction,
        transaction_id,
        options=[
            load_only(
                Transaction.sender_id,
                Transaction.recipient_id,
                Transaction.amount,
                Transaction.currency,
                Transaction.status,
                Transaction.created_at,
                Transaction.resolved_at,
            )
        ],
    )
    if tx is None:
        return None
    now = as_of or utcnow()
    settled_at = (
        (tx.resolved_at or tx.created_at) if tx.status == TransactionStatus.APPROVED else None
    )
    cutoff = min(now, settled_at + timedelta(hours=WINDOW_HOURS)) if settled_at else now
    report = FundsTrace(
        transaction_id=tx.id,
        recipient_id=tx.recipient_id,
        status=tx.status,
        amount=tx.amount,
        currency=tx.currency,
        settled_at=settled_at,
        observed_until=cutoff,
        outcome="not_settled",
        window_hours=WINDOW_HOURS,
        max_hops=MAX_HOPS,
        max_candidates=MAX_CANDIDATES,
        links=[],
    )
    if settled_at is None:
        return report
    if settled_at > now:
        report.outcome = "insufficient_evidence"
        return report
    anchor = Movement(tx.id, tx.sender_id, tx.recipient_id, tx.amount, settled_at)
    candidates, report.truncated = await _candidates(session, anchor, tx.currency, cutoff)
    report.candidates_examined = len(candidates)
    allocate(anchor, candidates, report)
    report.outcome = "possible_flow" if report.links else "no_match"
    if not report.links and (report.ambiguous_count or report.truncated):
        report.outcome = "insufficient_evidence"
    return report

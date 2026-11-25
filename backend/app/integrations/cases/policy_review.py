"""Read-only paired replay of extra holds against immutable initial decisions."""

import uuid
from collections import defaultdict
from datetime import datetime
from decimal import Decimal

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.cases.models import CaseEvent, FraudCase
from app.integrations.cases.schemas import OUTCOME_REASONS, PolicyComparison, PolicyResult
from app.integrations.models import GuardianReport
from app.models import Transaction


async def compare_policies(
    session: AsyncSession, now: datetime, *, start: datetime | None = None
) -> PolicyComparison:
    query = select(
        Transaction.id,
        Transaction.created_at,
        Transaction.amount,
        Transaction.currency,
        Transaction.evaluation_snapshot["status"].label("initial_status"),
        Transaction.evaluation_snapshot["risk_score"].label("initial_score"),
    ).where(Transaction.created_at <= now)
    if start is not None:
        query = query.where(Transaction.created_at >= start)
    sample = (
        await session.execute(
            query.order_by(Transaction.created_at.desc(), Transaction.id.desc()).limit(100)
        )
    ).all()
    metrics = PolicyComparison(
        sampled=len(sample),
        first_sample_at=sample[-1].created_at if sample else None,
        last_sample_at=sample[0].created_at if sample else None,
    )
    labels: dict[uuid.UUID, set[str]] = defaultdict(set)
    reason = CaseEvent.result["reason"].as_string()
    rows = await session.execute(
        select(GuardianReport.transaction_id, reason)
        .join(FraudCase, FraudCase.report_id == GuardianReport.id)
        .join(
            CaseEvent,
            and_(CaseEvent.case_id == FraudCase.id, CaseEvent.version == FraudCase.version),
        )
        .where(
            GuardianReport.transaction_id.in_([row.id for row in sample]),
            GuardianReport.expires_at > now,
            FraudCase.expires_at > now,
            FraudCase.state == "CLOSED",
            CaseEvent.created_at <= now,
            CaseEvent.code == "TRANSITION",
            reason.in_(OUTCOME_REASONS),
        )
        .distinct()
    )
    for tx_id, outcome in rows:
        if tx_id is not None:
            labels[tx_id].add(outcome)
    # Each eligible transfer appears once, even when multiple cases refer to it.
    observations: list[tuple[bool, int, str | None, Decimal | None]] = []
    for tx_id, _, amount, currency, decision, score in sample:
        if (
            decision not in {"approved", "cooling_off", "blocked"}
            or type(score) is not int
            or not 0 <= score <= 100
        ):
            continue
        outcomes = labels[tx_id]
        label = next(iter(outcomes)) if len(outcomes) == 1 else None
        observations.append(
            (decision != "approved", score, label, amount if currency == "KZT" else None)
        )

    metrics.evaluated = len(observations)
    metrics.fraud_labelled = sum(label == "confirmed_fraud" for _, _, label, _ in observations)
    metrics.legitimate_labelled = sum(
        label == "legitimate_transfer" for _, _, label, _ in observations
    )
    if observations:
        metrics.label_coverage = (metrics.fraud_labelled + metrics.legitimate_labelled) / len(
            observations
        )

    for threshold in (None, 25, 30, metrics.candidate_threshold, 40):
        missed = false_holds = extra_holds = 0
        missed_kzt = false_hold_kzt = Decimal("0.00")
        has_fraud_kzt = has_legitimate_kzt = False
        for held, score, label, amount in observations:
            extra = not held and threshold is not None and score >= threshold
            extra_holds += int(extra)
            intervened = held or extra
            missed += int(label == "confirmed_fraud" and not intervened)
            false_holds += int(label == "legitimate_transfer" and intervened)
            if amount is not None and label == "confirmed_fraud":
                has_fraud_kzt = True
                if not intervened:
                    missed_kzt += amount
            if amount is not None and label == "legitimate_transfer":
                has_legitimate_kzt = True
                if intervened:
                    false_hold_kzt += amount
        metrics.policies.append(
            PolicyResult(
                threshold=threshold,
                extra_holds=extra_holds,
                missed_fraud_kzt=missed_kzt if has_fraud_kzt else None,
                legitimate_held_kzt=false_hold_kzt if has_legitimate_kzt else None,
                missed_fraud=missed if metrics.fraud_labelled else None,
                false_interventions=false_holds if metrics.legitimate_labelled else None,
                false_per_1000_legitimate=(
                    1000 * false_holds / metrics.legitimate_labelled
                    if metrics.legitimate_labelled
                    else None
                ),
            )
        )
        # Keep the original API's baseline and threshold-35 projection for older clients.
        if threshold is None:
            metrics.baseline_detected = metrics.fraud_labelled - missed
            metrics.baseline_false_interventions = false_holds
        elif threshold == metrics.candidate_threshold:
            metrics.extra_holds = extra_holds
            metrics.candidate_detected = metrics.fraud_labelled - missed
            metrics.candidate_false_interventions = false_holds
    return metrics

"""Read-only paired replay of the recorded decision and an earlier holding threshold."""

import uuid
from collections import defaultdict
from datetime import datetime

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.cases.models import CaseEvent, FraudCase
from app.integrations.cases.schemas import OUTCOME_REASONS, PolicyComparison
from app.integrations.models import GuardianReport
from app.models import Transaction


async def compare_policies(session: AsyncSession, now: datetime) -> PolicyComparison:
    # Bound work and examine the immutable initial evaluation, including for a later cancellation.
    sample = (
        await session.execute(
            select(
                Transaction.id,
                Transaction.evaluation_snapshot["status"].label("initial_status"),
                Transaction.evaluation_snapshot["risk_score"].label("initial_score"),
            )
            .order_by(Transaction.created_at.desc(), Transaction.id.desc())
            .limit(100)
        )
    ).all()
    metrics = PolicyComparison(sampled=len(sample))
    if not sample:
        return metrics
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
            CaseEvent.code == "TRANSITION",
            reason.in_(OUTCOME_REASONS),
        )
        .distinct()
    )
    for tx_id, outcome in rows:
        if tx_id is not None:
            labels[tx_id].add(outcome)
    for tx_id, decision, score in sample:
        if (
            decision not in {"approved", "cooling_off", "blocked"}
            or type(score) is not int
            or not 0 <= score <= 100
        ):
            continue
        metrics.evaluated += 1
        baseline = decision in {"cooling_off", "blocked"}
        candidate = baseline or score >= metrics.candidate_threshold
        metrics.extra_holds += int(candidate and not baseline)
        # Multiple cases may refer to one transfer. Disagreement is not ground truth.
        if labels[tx_id] == {"confirmed_fraud"}:
            metrics.fraud_labelled += 1
            metrics.baseline_detected += int(baseline)
            metrics.candidate_detected += int(candidate)
        elif labels[tx_id] == {"legitimate_transfer"}:
            metrics.legitimate_labelled += 1
            metrics.baseline_false_interventions += int(baseline)
            metrics.candidate_false_interventions += int(candidate)
    return metrics

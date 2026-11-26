"""Aggregate original holds and retained adjudications for a single officer-selected cohort."""

import csv
import io
from datetime import datetime, time, timedelta, timezone
from math import ceil
from statistics import median
from typing import Any

from pydantic import BaseModel
from sqlalchemy import and_, case, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.integrations.cases.models import CaseEvent, FraudCase
from app.integrations.models import GuardianReport
from app.models import RiskEvent, Transaction, TransactionStatus


class MetricRow(BaseModel):
    key: str
    kk: str
    ru: str
    value: int | float | None


class HoldMetrics(BaseModel):
    days: int
    start: datetime
    as_of: datetime
    held: int
    cancelled: int
    released: int
    referred: int
    confirmed_fraud: int
    confirmed_share: float | None
    labelled: int
    false_holds: dict[str, int]
    rules: dict[str, int]
    responses: int
    median_seconds: float | None
    p90_seconds: float | None
    rows: list[MetricRow] = []
    csv: str = ""


def period_start(days: int, end: datetime) -> datetime:
    if days not in (7, 30, 90):
        raise ValueError("unsupported_period")
    zone = timezone(timedelta(hours=5))
    first_day = end.astimezone(zone).date() - timedelta(days=days - 1)
    return datetime.combine(first_day, time.min, zone)


async def hold_metrics(
    session: AsyncSession, days: int, end: datetime | None = None
) -> HoldMetrics:
    end = end or utcnow()
    start = period_start(days, end)
    cohort = Transaction.created_at.between(start, end)
    cases = (
        select(
            GuardianReport.transaction_id.label("tx"),
            FraudCase.id.label("id"),
            GuardianReport.created_at.label("reported"),
            case(
                (
                    and_(FraudCase.state == "CLOSED", CaseEvent.code == "TRANSITION"),
                    CaseEvent.result["reason"].as_string(),
                ),
                else_=None,
            ).label("outcome"),
        )
        .select_from(GuardianReport)
        .join(Transaction, Transaction.id == GuardianReport.transaction_id)
        .join(FraudCase, FraudCase.report_id == GuardianReport.id)
        .outerjoin(
            CaseEvent,
            and_(
                CaseEvent.case_id == FraudCase.id,
                CaseEvent.version == FraudCase.version,
                CaseEvent.created_at <= end,
            ),
        )
        .where(
            cohort,
            GuardianReport.expires_at > end,
            FraudCase.expires_at > end,
            GuardianReport.created_at <= end,
            FraudCase.created_at <= end,
        )
        .cte("linked_cases")
    )
    known = cases.c.outcome.in_(("confirmed_fraud", "legitimate_transfer"))
    labels = (
        select(
            cases.c.tx,
            func.count(distinct(case((known, cases.c.outcome)))).label("n"),
            func.min(case((known, cases.c.outcome))).label("label"),
        )
        .group_by(cases.c.tx)
        .subquery()
    )
    fraud = and_(labels.c.n == 1, labels.c.label == "confirmed_fraud")
    honest = and_(labels.c.n == 1, labels.c.label == "legitimate_transfer")
    segments = {
        "new_recipient": Transaction.is_new_recipient.is_(True),
        "active_call": Transaction.active_call.is_(True),
        "kzt_below_100k": and_(Transaction.currency == "KZT", Transaction.amount < 100000),
        "kzt_100k_to_500k": and_(
            Transaction.currency == "KZT", Transaction.amount >= 100000, Transaction.amount < 500000
        ),
        "kzt_500k_plus": and_(Transaction.currency == "KZT", Transaction.amount >= 500000),
    }

    def count_if(condition: Any) -> Any:
        return func.count(case((condition, 1)))

    held = Transaction.evaluation_snapshot["status"].as_string() == "cooling_off"
    counts = (
        (
            await session.execute(
                select(
                    func.count(Transaction.id).label("held"),
                    count_if(
                        and_(
                            Transaction.status == TransactionStatus.CANCELLED,
                            Transaction.resolution_action == "cancel",
                        )
                    ).label("cancelled"),
                    count_if(
                        and_(
                            Transaction.status == TransactionStatus.APPROVED,
                            Transaction.resolution_action == "resolve",
                        )
                    ).label("released"),
                    func.count(labels.c.tx).label("referred"),
                    count_if(fraud).label("fraud"),
                    count_if(labels.c.n == 1).label("labelled"),
                    *(
                        count_if(and_(honest, segment)).label(name)
                        for name, segment in segments.items()
                    ),
                )
                .select_from(Transaction)
                .outerjoin(labels, labels.c.tx == Transaction.id)
                .where(cohort, held)
            )
        )
        .mappings()
        .one()
    )
    frequency = func.count(distinct(RiskEvent.transaction_id))
    rules = (
        await session.execute(
            select(RiskEvent.rule_code, frequency)
            .join(Transaction, Transaction.id == RiskEvent.transaction_id)
            .where(cohort, RiskEvent.created_at <= end)
            .group_by(RiskEvent.rule_code)
            .order_by(frequency.desc(), RiskEvent.rule_code)
            .limit(10)
        )
    ).all()
    reactions = (
        await session.execute(
            select(cases.c.reported, func.min(CaseEvent.created_at))
            .join(CaseEvent, CaseEvent.case_id == cases.c.id)
            .where(
                CaseEvent.actor_role == "soc",
                CaseEvent.created_at >= cases.c.reported,
                CaseEvent.created_at <= end,
            )
            .group_by(cases.c.id, cases.c.reported)
        )
    ).all()
    times = sorted((first - reported).total_seconds() for reported, first in reactions)
    total = counts["held"]
    result = HoldMetrics(
        days=days,
        start=start,
        as_of=end,
        held=total,
        cancelled=counts["cancelled"],
        released=counts["released"],
        referred=counts["referred"],
        confirmed_fraud=counts["fraud"],
        confirmed_share=counts["fraud"] / total if total else None,
        labelled=counts["labelled"],
        false_holds={key: counts[key] for key in segments},
        rules=dict(rules),
        responses=len(times),
        median_seconds=median(times) if times else None,
        p90_seconds=times[ceil(len(times) * 0.9) - 1] if times else None,
    )
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    metrics: list[tuple[str, str, str, int | float | None]] = [
        ("held", "Бастапқыда кідіртілген", "Первоначально удержаны", result.held),
        ("cancelled", "Клиент бас тартты", "Клиент отменил", result.cancelled),
        ("released", "Кідірістен кейін жіберілді", "Выпущены после паузы", result.released),
        ("referred", "SOC ісіне тіркелді", "Переданы в дело SOC", result.referred),
        ("fraud", "Алаяқтық расталды", "Подтверждено мошенничество", result.confirmed_fraud),
        (
            "labelled",
            "Нәтижесі белгілі кідірістер",
            "Удержания с известным исходом",
            result.labelled,
        ),
        (
            "confirmed_pct",
            "Барлық кідірістің ішінде расталған алаяқтық, %",
            "Подтверждённое мошенничество среди всех удержаний, %",
            100 * result.confirmed_fraud / total if total else None,
        ),
        (
            "responses",
            "Алғашқы жауап берілген істер",
            "Дела с первым ответом сотрудника",
            result.responses,
        ),
        ("p50_s", "Алғашқы жауап медианасы, с", "Медиана первого ответа, с", result.median_seconds),
        ("p90_s", "Алғашқы жауап, p90, с", "Первый ответ, p90, с", result.p90_seconds),
    ]
    names = {
        "new_recipient": ("жаңа алушы", "новый получатель"),
        "active_call": ("қоңырау", "звонок"),
        "kzt_below_100k": ("< 100 000 ₸", "< 100 000 ₸"),
        "kzt_100k_to_500k": ("100 000–499 999,99 ₸", "100 000–499 999,99 ₸"),
        "kzt_500k_plus": ("≥ 500 000 ₸", "≥ 500 000 ₸"),
    }
    for key, (kk, ru) in names.items():
        metrics.append(
            (key, "Адал аударым кідірді · " + kk, "Ложные паузы · " + ru, result.false_holds[key])
        )
    for rule, number in result.rules.items():
        metrics.append(("rule_" + rule, "Ереже · " + rule, "Правило · " + rule, number))
    writer.writerow(("period_start", "as_of", "metric", "kk", "ru", "value"))
    for key, kk, ru, value in metrics:
        row = MetricRow(key=key, kk=kk, ru=ru, value=value)
        result.rows.append(row)
        writer.writerow((start.isoformat(), end.isoformat(), key, kk, ru, value))
    result.csv = output.getvalue()
    return result

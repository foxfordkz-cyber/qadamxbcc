"""Read-only synthetic wallet. Bank decisions and transfer execution stay in the core."""

import math
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException, Query
from sqlalchemy import Date, and_, case, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import SessionDep
from app.db.base import utcnow
from app.integrations.cases.models import FraudCase
from app.integrations.cases.policy_review import compare_policies
from app.integrations.cases.schemas import CaseOut, State
from app.mobile_gateway.app import IdentityDep
from app.mobile_gateway.protection import client
from app.models import Account, Transaction, TransactionStatus
from app.services.soc import LATENCY_SAMPLE_LIMIT

KZ = timezone(timedelta(hours=5))
OPENING = Decimal("5000000.00")
T = Transaction
Direction = Literal["incoming", "outgoing"]


def window(days: int) -> tuple[date, datetime, datetime]:
    if days not in (7, 30, 90):
        raise HTTPException(422, "wallet_period")
    now = utcnow()
    first = now.astimezone(KZ).date() - timedelta(days=days - 1)
    return first, datetime.combine(first, time.min, KZ), now


def received(owner: UUID) -> Any:
    return and_(
        T.recipient_id == owner, T.sender_id != owner, T.status == TransactionStatus.APPROVED
    )


def sent(owner: UUID) -> Any:
    return and_(T.sender_id == owner, T.recipient_id != owner)


def total_amount(condition: Any) -> Any:
    return func.coalesce(func.sum(case((condition, T.amount), else_=0)), 0)


def money(value: Any) -> str:
    return format(Decimal(str(value or 0)).quantize(Decimal("0.01")), "f")


def day_column(db: AsyncSession) -> Any:
    if db.get_bind().dialect.name == "postgresql":
        return cast(func.timezone("Asia/Almaty", T.created_at), Date)
    return func.date(T.created_at, "+5 hours")


async def balance(db: AsyncSession, owner: UUID) -> str:
    incoming, outgoing = (
        await db.execute(
            select(
                total_amount(received(owner)),
                total_amount(and_(sent(owner), T.status == TransactionStatus.APPROVED)),
            ).where(or_(T.sender_id == owner, T.recipient_id == owner))
        )
    ).one()
    return money(OPENING + Decimal(incoming) - Decimal(outgoing))


def operation(tx: Transaction, name: str, owner: UUID) -> dict[str, Any]:
    return {
        "transaction_id": tx.id,
        "counterparty": name,
        "status": tx.status,
        "amount": money(tx.amount),
        "created_at": tx.created_at,
        "direction": "outgoing" if tx.sender_id == owner else "incoming",
    }


def install_wallet(app: FastAPI) -> None:
    base = "/mobile/v1/wallet"

    @app.get(base + "/operations")
    async def operations(
        principal: IdentityDep,
        session: SessionDep,
        days: int | None = None,
        status: TransactionStatus | None = None,
        direction: Direction | None = None,
        day: date | None = None,
        through: date | None = None,
        q: Annotated[str, Query(max_length=128)] = "",
        limit: Annotated[int, Query(ge=1, le=50)] = 20,
        offset: Annotated[int, Query(ge=0, le=10000)] = 0,
    ) -> dict[str, Any]:
        owner = client(principal)
        inbound = received(owner)
        stmt = (
            select(T, Account.full_name)
            .join(
                Account,
                Account.id == case((T.sender_id == owner, T.recipient_id), else_=T.sender_id),
            )
            .where(or_(T.sender_id == owner, inbound))
        )
        if days is not None:
            _, start, end = window(days)
            stmt = stmt.where(T.created_at.between(start, end))
        if through and (not day or not 0 <= (through - day).days < 90):
            raise HTTPException(422, "wallet_date_range")
        if day:
            stop_day = through or day
            if stop_day == date.max:
                raise HTTPException(422, "wallet_date_range")
            start = datetime.combine(day, time.min, KZ)
            end = datetime.combine(stop_day + timedelta(days=1), time.min, KZ)
            stmt = stmt.where(T.created_at >= start, T.created_at < end)
        if status:
            stmt = stmt.where(T.status == status)
        if direction:
            stmt = stmt.where(inbound if direction == "incoming" else T.sender_id == owner)
        if q.strip():
            try:
                ident = UUID(q.strip())
            except ValueError:
                ident = None
            stmt = stmt.where(
                or_(Account.full_name.icontains(q.strip(), autoescape=True), T.id == ident)
            )
        rows = (
            await session.execute(
                stmt.order_by(T.created_at.desc(), T.id.desc()).offset(offset).limit(limit + 1)
            )
        ).all()
        return {
            "items": [operation(t, name, owner) for t, name in rows[:limit]],
            "offset": offset,
            "has_more": len(rows) > limit,
        }

    @app.get(base + "/incoming/{txid}")
    async def incoming(txid: UUID, principal: IdentityDep, session: SessionDep) -> dict[str, Any]:
        owner = client(principal)
        row = (
            await session.execute(
                select(T, Account.full_name)
                .join(Account, Account.id == T.sender_id)
                .where(T.id == txid, received(owner))
            )
        ).first()
        if not row:
            raise HTTPException(404, "operation_not_found")
        return operation(row[0], row[1], owner)

    @app.get(base + "/analytics")
    async def analytics(
        principal: IdentityDep, session: SessionDep, days: int = 7
    ) -> dict[str, Any]:
        owner = client(principal)
        first, start, end = window(days)
        bucket = day_column(session)
        inbound = received(owner)
        rows = (
            await session.execute(
                select(
                    bucket,
                    func.count(T.id),
                    total_amount(inbound),
                    total_amount(and_(sent(owner), T.status == TransactionStatus.APPROVED)),
                    func.sum(case((T.status == TransactionStatus.BLOCKED, 1), else_=0)),
                    func.sum(case((T.status == TransactionStatus.COOLING_OFF, 1), else_=0)),
                )
                .where(or_(T.sender_id == owner, inbound), T.created_at.between(start, end))
                .group_by(bucket)
            )
        ).all()
        by_date = {
            str(d): (n, inc, out, blocked, paused) for d, n, inc, out, blocked, paused in rows
        }
        series = []
        for i in range(days):
            key = str(first + timedelta(days=i))
            count, inc, out, blocked, paused = by_date.get(key, (0, 0, 0, 0, 0))
            series.append(
                {
                    "day": key,
                    "count": count,
                    "incoming": money(inc),
                    "outgoing": money(out),
                    "blocked": blocked,
                    "paused": paused,
                }
            )
        return {
            "days": days,
            "from": first,
            "as_of": end,
            "timezone": "Asia/Almaty",
            "series": series,
            "count": sum(int(r["count"]) for r in series),
            "incoming": money(sum(Decimal(str(r["incoming"])) for r in series)),
            "outgoing": money(sum(Decimal(str(r["outgoing"])) for r in series)),
            "blocked": sum(int(r["blocked"]) for r in series),
            "paused": sum(int(r["paused"]) for r in series),
        }

    @app.get(base + "/cases")
    async def cases(
        principal: IdentityDep,
        session: SessionDep,
        state: State | None = None,
        report_id: UUID | None = None,
        offset: Annotated[int, Query(ge=0, le=10000)] = 0,
    ) -> dict[str, Any]:
        if principal.role != "admin":
            raise HTTPException(403, "soc_required")
        stmt = select(FraudCase).where(FraudCase.expires_at > utcnow())
        if report_id is not None:
            stmt = stmt.where(FraudCase.report_id == report_id)
        if state:
            stmt = stmt.where(FraudCase.state == state)
        rows = (
            await session.scalars(
                stmt.order_by(FraudCase.created_at.desc(), FraudCase.id.desc())
                .offset(offset)
                .limit(21)
            )
        ).all()
        return {
            "items": [CaseOut.model_validate(r) for r in rows[:20]],
            "offset": offset,
            "has_more": len(rows) > 20,
        }

    @app.get(base + "/graph-operations")
    async def graph_operations(
        principal: IdentityDep,
        session: SessionDep,
        node: UUID,
        recipient: UUID | None = None,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> dict[str, Any]:
        if principal.role != "admin":
            raise HTTPException(403, "soc_required")
        match = (
            or_(T.sender_id == node, T.recipient_id == node)
            if recipient is None
            else and_(T.sender_id == node, T.recipient_id == recipient)
        )
        rows = (
            await session.scalars(
                select(T)
                .where(match)
                .order_by(T.created_at.desc(), T.id.desc())
                .offset(offset)
                .limit(21)
            )
        ).all()
        return {
            "items": [
                {
                    "transaction_id": row.id,
                    "amount": money(row.amount),
                    "created_at": row.created_at,
                    "status": row.status.value,
                }
                for row in rows[:20]
            ],
            "has_more": len(rows) > 20,
        }

    @app.get(base + "/soc")
    async def soc(
        principal: IdentityDep, session: SessionDep, days: int = 7, include_policy: bool = False
    ) -> dict[str, Any]:
        if principal.role != "admin":
            raise HTTPException(403, "soc_required")
        first, start, end = window(days)
        blocked = T.status == TransactionStatus.BLOCKED
        rows = (
            await session.execute(
                select(T.status, func.count(T.id), func.sum(T.amount))
                .where(T.created_at.between(start, end))
                .group_by(T.status)
            )
        ).all()
        cases = (
            await session.execute(
                select(FraudCase.state, func.count(FraudCase.id))
                .where(FraudCase.created_at.between(start, end))
                .group_by(FraudCase.state)
            )
        ).all()
        hubs, latency = (
            await session.execute(
                select(
                    func.count(func.distinct(case((blocked, T.recipient_id)))),
                    func.avg(T.latency_ms),
                ).where(T.created_at.between(start, end))
            )
        ).one()
        daily = day_column(session)
        activity = (
            await session.execute(
                select(daily, T.status, func.count(T.id))
                .where(T.created_at.between(start, end))
                .group_by(daily, T.status)
            )
        ).all()
        series: dict[str, dict[str, Any]] = {
            str(first + timedelta(days=i)): {"day": str(first + timedelta(days=i)), "states": {}}
            for i in range(days)
        }
        for day, state, count in activity:
            series[str(day)]["states"][state] = count
        measured = await session.scalars(
            select(T.latency_ms)
            .where(T.created_at.between(start, end), T.latency_ms > 0)
            .order_by(T.created_at.desc(), T.id.desc())
            .limit(LATENCY_SAMPLE_LIMIT)
        )
        sample = sorted(float(ms) for ms in measured if math.isfinite(ms))
        return {
            "days": days,
            "from": first,
            "as_of": end,
            "states": {k: {"count": n, "amount": money(v)} for k, n, v in rows},
            "case_states": dict(cases),
            "blocked_recipients": hubs,
            "mean_engine_ms": latency,
            "series": list(series.values()),
            "p95_engine_ms": sample[math.ceil(len(sample) * 0.95) - 1] if sample else None,
            "latency_sample_size": len(sample),
            "latency_sample_limit": LATENCY_SAMPLE_LIMIT,
            **(
                {"policy_comparison": await compare_policies(session, end, start=start)}
                if include_policy
                else {}
            ),
        }

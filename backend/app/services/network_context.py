"""Trusted login observations used as weak corroborating P2P signals."""

from datetime import datetime, timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import case, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import utcnow
from app.models import Account, NetworkObservation
from app.schemas.transfers import BankSessionObservation

RETENTION = timedelta(days=30)
FRESH = timedelta(hours=1)


async def ingest(session: AsyncSession, event: BankSessionObservation) -> None:
    now = utcnow()
    if not now - RETENTION <= event.observed_at <= now:
        raise HTTPException(422, "outside_observation_window")
    if await session.get(Account, event.account_id) is None:
        raise HTTPException(404, "account_not_found")
    insert = pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
    values = event.model_dump()
    await session.execute(
        insert(NetworkObservation)
        .values(**values, received_at=now)
        .on_conflict_do_nothing(index_elements=["id"])
    )
    stored = await session.get(NetworkObservation, event.id)
    if stored is None or any(getattr(stored, key) != value for key, value in values.items()):
        raise HTTPException(409, "observation_id_conflict")
    await session.execute(
        update(Account).where(Account.id == event.account_id).values(has_network_history=True)
    )
    await session.execute(
        delete(NetworkObservation).where(NetworkObservation.observed_at < now - RETENTION)
    )
    await session.commit()


async def signals(
    session: AsyncSession, sender: Account, recipient: Account, at: datetime
) -> tuple[int, str | None]:
    if not (sender.has_network_history or recipient.has_network_history):
        return 0, None
    obs = NetworkObservation

    async def latest(account_id: UUID) -> NetworkObservation | None:
        return await session.scalar(
            select(obs)
            .where(
                obs.account_id == account_id,
                obs.observed_at.between(at - FRESH, at),
                obs.received_at <= at,
            )
            .order_by(obs.observed_at.desc(), obs.received_at.desc(), obs.id.desc())
            .limit(1)
        )

    source = await latest(sender.id) if sender.has_network_history else None
    target = await latest(recipient.id) if recipient.has_network_history else None
    shared = 0
    if target is not None:
        members = (
            select(obs.account_id)
            .where(
                obs.network_token == target.network_token,
                obs.observed_at.between(at - FRESH, at),
                obs.received_at <= at,
            )
            .distinct()
            .limit(4)
            .subquery()
        )
        size = int(await session.scalar(select(func.count()).select_from(members)) or 0)
        if size >= 3 or (source is not None and source.network_token == target.network_token):
            shared = size
    if source is None:
        return shared, None
    # Require two days of established history. Repeated logins today cannot establish a city.
    oldest, newest, seen_country, seen_city, known_city = (
        await session.execute(
            select(
                func.min(obs.observed_at),
                func.max(obs.observed_at),
                func.max(case((obs.country == source.country, 1), else_=0)),
                func.max(
                    case(((obs.country == source.country) & (obs.city == source.city), 1), else_=0)
                ),
                func.max(
                    case(((obs.country == source.country) & obs.city.is_not(None), 1), else_=0)
                ),
            ).where(
                obs.account_id == sender.id,
                obs.received_at <= at,
                obs.observed_at.between(at - RETENTION, at - timedelta(days=1)),
            )
        )
    ).one()
    if oldest is None or newest is None or newest - oldest < timedelta(days=1):
        return shared, None
    if not seen_country:
        return shared, "country"
    if known_city and not seen_city and source.city:
        return shared, "city"
    return shared, None

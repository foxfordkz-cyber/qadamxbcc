from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import fakeredis
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.kz import is_valid_iin, is_valid_kz_iban
from app.core.resources import Resources
from app.main import create_app
from app.models import Account, EdgeType, GraphEdge, Transaction
from scripts.seed_bcc import (
    DEMO_ACCOUNTS,
    DEMO_PRESETS,
    FRIEND_ID,
    HUB_DEVICE,
    HUB_ID,
    SENDER_ID,
    render_summary,
    seed,
)

N_ACCOUNTS, N_TX = 120, 700


async def _presets(
    session_factory: async_sessionmaker[AsyncSession], redis: fakeredis.FakeAsyncRedis
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    app = create_app(
        settings, Resources.build(settings, session_factory=session_factory, redis=redis)
    )
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            for preset in DEMO_PRESETS:
                resp = await client.post("/api/v1/transfers/evaluate", json=preset.payload())
                assert resp.status_code == 200, resp.text
                yield preset.expected.value, resp.json()


async def test_seed_is_idempotent_with_exact_demo_accounts(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    redis = fakeredis.FakeAsyncRedis()
    first = await seed(
        session_factory, redis, n_background_accounts=N_ACCOUNTS, n_background_transactions=N_TX
    )
    second = await seed(
        session_factory, redis, n_background_accounts=N_ACCOUNTS, n_background_transactions=N_TX
    )

    assert first.accounts == second.accounts == 124
    assert first.by_status == second.by_status
    assert first.transactions == second.transactions == 700 + 14
    assert second.redis_keys_cleared > 0
    assert first.engine_p95_ms < 50
    assert "00000000-0000-4000-8000-000000000004" in render_summary(second)

    now = datetime.now(UTC)
    async with session_factory() as session:
        accounts = {a.id: a for a in (await session.execute(select(Account))).scalars()}
        for spec in DEMO_ACCOUNTS:
            acc = accounts[spec.id]
            assert (acc.full_name, acc.phone) == (spec.full_name, spec.phone)
        assert all(is_valid_iin(a.iin) for a in accounts.values())
        assert all(is_valid_kz_iban(a.iban) and a.iban[4:7] == "856" for a in accounts.values())
        assert len({a.phone for a in accounts.values()}) == len(accounts)
        assert [a.id for a in accounts.values() if a.device_id == HUB_DEVICE].count(HUB_ID) == 1
        assert sum(a.device_id == HUB_DEVICE for a in accounts.values()) == 2  # hub + 1 twin

        friend_history = (
            (
                await session.execute(
                    select(Transaction.status).where(
                        Transaction.sender_id.in_([SENDER_ID, FRIEND_ID]),
                        Transaction.recipient_id.in_([SENDER_ID, FRIEND_ID]),
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(friend_history) == 7
        assert {s.value for s in friend_history} == {"approved"}

        victims = (
            await session.execute(
                select(Transaction.sender_id, Transaction.created_at).where(
                    Transaction.recipient_id == HUB_ID
                )
            )
        ).all()
        assert len({sid for sid, _ in victims}) == 12
        assert all(now - at < timedelta(minutes=30) for _, at in victims)
        cashout = (
            await session.execute(
                select(func.count())
                .select_from(GraphEdge)
                .where(GraphEdge.source_id == HUB_ID, GraphEdge.edge_type == EdgeType.TRANSFER)
            )
        ).scalar()
        assert cashout == 2

    in_key = f"bcc:vel:in:{HUB_ID}"
    members = await redis.zrangebyscore(in_key, now.timestamp() - 1800, "+inf")
    senders = {(m.decode() if isinstance(m, bytes) else str(m)).split(":")[1] for m in members}
    assert len(senders) == 12

    async for expected, data in _presets(session_factory, redis):
        assert data["status"] == expected, data["reasons"]
    await redis.aclose()


async def test_presets_hold_45_minutes_after_seeding(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """The demo may start a while after seeding; outcomes must not flip within the hour."""
    redis = fakeredis.FakeAsyncRedis()
    await seed(
        session_factory,
        redis,
        now=datetime.now(UTC) - timedelta(minutes=45),
        n_background_accounts=N_ACCOUNTS,
        n_background_transactions=N_TX,
    )
    async for expected, data in _presets(session_factory, redis):
        assert data["status"] == expected, data["reasons"]
    await redis.aclose()

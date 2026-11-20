import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import fakeredis
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.kz import is_valid_iin, is_valid_kz_iban
from app.core.resources import Resources
from app.main import create_app
from app.models import (
    AbandonedRequest,
    Account,
    EdgeType,
    GraphEdge,
    PaymentReturn,
    ProjectionEvent,
    RecipientFlagAudit,
    Transaction,
)
from app.schemas.soc import RecipientFlagRequest
from app.services.graph import GraphStore
from app.services.recipient_flags import set_flag
from scripts import seed_bcc
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
from tests.test_service_boundaries import pilot

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
    async with session_factory() as session:
        if session.get_bind().dialect.name == "sqlite":
            await session.execute(text("PRAGMA foreign_keys=ON"))
    first = await seed(
        session_factory, redis, n_background_accounts=N_ACCOUNTS, n_background_transactions=N_TX
    )
    abandoned_id = uuid.uuid4()
    async with session_factory() as session:
        transaction_id = await session.scalar(select(Transaction.id).limit(1))
        assert transaction_id is not None
        reversal_id = await session.scalar(
            select(Transaction.id).where(Transaction.id != transaction_id).limit(1)
        )
        assert reversal_id is not None
        session.add(PaymentReturn(original_id=transaction_id, refund_transaction_id=reversal_id))
        session.add(ProjectionEvent(transaction_id=transaction_id))
        session.add(AbandonedRequest(request_id=abandoned_id))
        await session.commit()
        await set_flag(
            session,
            GraphStore(),
            FRIEND_ID,
            RecipientFlagRequest(
                flagged=True,
                note="Synthetic reset regression",
                request_id=uuid.uuid4(),
                expected_version=0,
            ),
            "local_demo_soc",
        )
        assert await session.scalar(select(func.count()).select_from(RecipientFlagAudit)) == 1
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
        assert await session.scalar(select(func.count()).select_from(ProjectionEvent)) == 0
        assert await session.scalar(select(func.count()).select_from(RecipientFlagAudit)) == 0
        assert await session.scalar(select(func.count()).select_from(PaymentReturn)) == 0
        assert await session.get(AbandonedRequest, abandoned_id) is not None
        accounts = {a.id: a for a in (await session.execute(select(Account))).scalars()}
        for spec in DEMO_ACCOUNTS:
            acc = accounts[spec.id]
            assert (acc.full_name, acc.phone) == (spec.full_name, spec.phone)
            assert not acc.is_flagged
            assert acc.flag_version == 0
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


async def test_demo_seed_refuses_pilot_before_touching_dependencies(
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = fakeredis.FakeAsyncRedis()
    monkeypatch.setattr(seed_bcc, "get_settings", pilot)

    async def forbidden() -> None:
        pytest.fail("A pilot reset must stop before connecting to Redis or clearing SQL")

    monkeypatch.setattr(redis, "ping", forbidden)
    with pytest.raises(RuntimeError, match="disabled in pilot"):
        await seed(session_factory, redis)
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

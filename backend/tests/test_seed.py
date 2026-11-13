from datetime import UTC, datetime, timedelta

import fakeredis
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.kz import is_valid_iin, is_valid_kz_iban
from app.core.resources import Resources
from app.main import create_app
from app.models import Account, GraphEdge, Transaction
from scripts.seed_bcc import DEMO_PRESETS, DROP_HUB, render_summary, seed


async def test_seed_is_idempotent_and_presets_hit_expected_decisions(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    redis = fakeredis.FakeAsyncRedis()
    first = await seed(session_factory, redis, n_accounts=120, n_transactions=900)
    second = await seed(session_factory, redis, n_accounts=120, n_transactions=900)

    assert first.accounts == second.accounts == 120
    assert first.transactions == second.transactions == 900
    assert first.by_status == second.by_status
    assert second.redis_keys_cleared > 0
    assert first.by_status.get("approved", 0) > 800
    assert first.engine_p95_ms < 50

    async with session_factory() as session:
        accounts = (await session.execute(select(Account))).scalars().all()
        assert len(accounts) == 120
        assert all(is_valid_iin(a.iin) for a in accounts)
        assert all(is_valid_kz_iban(a.iban) and a.iban[4:7] == "856" for a in accounts)
        assert len({a.phone for a in accounts}) == 120
        tx_count = (await session.execute(select(func.count()).select_from(Transaction))).scalar()
        assert tx_count == 900
        hub_in = (
            await session.execute(
                select(func.count()).select_from(GraphEdge).where(GraphEdge.target_id == DROP_HUB)
            )
        ).scalar()
        assert hub_in == 18

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
                data = resp.json()
                assert data["status"] == preset.expected.value, (preset.key, data["reasons"])
            graph = (await client.get(f"/api/v1/soc/graph/{DROP_HUB}")).json()
            assert graph["nodes"][0]["data"]["in_degree"] == 18

    assert "drop_hub" in render_summary(second)
    await redis.aclose()


async def test_drop_hub_preset_stays_blocked_after_velocity_windows_expire(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Graph evidence alone must keep the demo deterministic if the demo starts late."""
    redis = fakeredis.FakeAsyncRedis()
    await seed(
        session_factory,
        redis,
        n_accounts=80,
        n_transactions=300,
        now=datetime.now(UTC) - timedelta(hours=3),
    )
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    app = create_app(
        settings, Resources.build(settings, session_factory=session_factory, redis=redis)
    )
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            for preset in DEMO_PRESETS:
                data = (
                    await client.post("/api/v1/transfers/evaluate", json=preset.payload())
                ).json()
                assert data["status"] == preset.expected.value, (preset.key, data["reasons"])
    await redis.aclose()

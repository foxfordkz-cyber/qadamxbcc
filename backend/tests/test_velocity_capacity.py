"""Bounded risk reads must reject incomplete history without changing settlement."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from math import fsum

import fakeredis
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.kz import make_kz_iban
from app.core.resources import Resources
from app.main import create_app
from app.models import Account, GraphEdge, Transaction, TransactionStatus
from app.services.velocity import (
    KEY_PREFIX,
    MAX_HISTORY_ROWS,
    RETENTION_S,
    VelocityCapacityError,
    VelocityCounters,
)

NOW = datetime.now(UTC).timestamp()


@pytest.mark.parametrize("decode_responses", [False, True])
async def test_nested_windows_match_independent_sums_at_every_boundary(
    decode_responses: bool,
) -> None:
    redis = fakeredis.FakeAsyncRedis(decode_responses=decode_responses)
    now = 100_000.5
    key = f"{KEY_PREFIX}:settled:out:sender"
    # Same counterparty across windows, tied timestamps on each edge, and a
    # legacy tx:amount member. The historical reader ignores non-numeric amounts.
    rows: list[tuple[str, float, str, float]] = [
        ("legacy:0.01", 1, "legacy", 0.01),
        ("current:recipient:0.02", 0, "recipient", 0.02),
    ]
    for span in (600, 1800, 3600, 86400):
        for index, delta in enumerate((-0.25, 0.0, 0.0, 0.25)):
            counterparty = ("recipient", "recurring", "tied", "recurring")[index]
            value = ("99999999.99", "0.01", "0.02", "0.10")[index]
            rows.append(
                (
                    f"t-{span}-{index}:{counterparty}:{value}",
                    span + delta,
                    counterparty,
                    float(value),
                )
            )
    try:
        members = {member: now - age for member, age, _, _ in rows}
        members["malformed:peer:none"] = now - 3
        members["future:recipient:1000"] = now + 1
        await redis.zadd(key, members)
        snapshot = await VelocityCounters(redis).snapshot(
            sender_id="sender", recipient_id="recipient", ts=now
        )
        for name, span in (("10m", 600), ("30m", 1800), ("1h", 3600), ("24h", 86400)):
            included = [(party, amount) for _, age, party, amount in rows if age < span]
            window = snapshot.settled_sender_out.windows[name]
            assert window.count == len(included)
            assert window.distinct == len({party for party, _ in included})
            assert window.volume == fsum(amount for _, amount in included)
        payee = [amount for _, age, party, amount in rows if age < 86400 and party == "recipient"]
        assert snapshot.settled_payee.count == len(payee)
        assert snapshot.settled_payee.total == fsum(payee)
        assert snapshot.settled_payee.largest == max(payee)
    finally:
        await redis.aclose()


@pytest.mark.parametrize(
    ("direction", "account"),
    [
        ("out", "sender"),
        ("in", "sender"),
        ("in", "recipient"),
        ("out", "recipient"),
        ("settled:out", "sender"),
        ("settled:in", "sender"),
        ("settled:in", "recipient"),
        ("settled:out", "recipient"),
    ],
)
async def test_every_history_rejects_overload_without_truncation(
    direction: str, account: str
) -> None:
    redis = fakeredis.FakeAsyncRedis()
    velocity = VelocityCounters(redis)
    key = f"{KEY_PREFIX}:{direction}:{account}"
    try:
        await redis.zadd(
            key, {f"tx-{i}:other-{i % 3}:100.75": NOW for i in range(MAX_HISTORY_ROWS)}
        )
        snapshot = await velocity.snapshot(sender_id="sender", recipient_id="recipient", ts=NOW)
        name = f"{account}_{direction}"
        if direction.startswith("settled:"):
            name = f"settled_{account}_{direction.split(':')[1]}"
        stat = snapshot.as_dict()[name]["24h"]
        assert stat == {
            "count": MAX_HISTORY_ROWS,
            "distinct": 3,
            "volume": MAX_HISTORY_ROWS * 100.75,
        }
        await redis.zadd(key, {"over-cap:other:100.75": NOW})
        with pytest.raises(VelocityCapacityError, match="capacity"):
            await velocity.snapshot(sender_id="sender", recipient_id="recipient", ts=NOW)
        assert await redis.zcard(key) == MAX_HISTORY_ROWS + 1
        # Once the complete overloaded window has expired, normal scoring resumes.
        result = await velocity.snapshot(
            sender_id="sender", recipient_id="recipient", ts=NOW + RETENTION_S + 1
        )
        assert result.as_dict()[name]["24h"]["count"] == 0
    finally:
        await redis.aclose()


async def test_redis_reads_are_bounded_even_with_large_or_expired_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis = fakeredis.FakeAsyncRedis()
    try:
        key = f"{KEY_PREFIX}:out:sender"
        await redis.zadd(key, {f"bulk-{i}:counterparty:1.00": NOW for i in range(10_000)})
        factory = redis.pipeline
        returned: list[int] = []

        def pipeline(*, transaction: bool = True) -> object:
            pipe = factory(transaction=transaction)
            execute = pipe.execute

            async def capture(*, raise_on_error: bool = True) -> object:
                result = await execute(raise_on_error=raise_on_error)
                returned.extend(len(rows) for rows in result[-8:] if isinstance(rows, list))
                return result

            monkeypatch.setattr(pipe, "execute", capture)
            return pipe

        monkeypatch.setattr(redis, "pipeline", pipeline)
        with pytest.raises(VelocityCapacityError, match="capacity"):
            await VelocityCounters(redis).snapshot(
                sender_id="sender", recipient_id="recipient", ts=NOW
            )
        assert returned == []  # Count-only preflight rejects without downloading any history.
        assert await redis.zcard(key) == 10_000
        # Exact open-left boundary: expired entries consume no read budget.
        await redis.zadd(
            key, {f"bulk-{i}:counterparty:1.00": NOW - RETENTION_S for i in range(10_000)}
        )
        await redis.zadd(key, {"active:counterparty:1.25": NOW})
        result = await VelocityCounters(redis).snapshot(
            sender_id="sender", recipient_id="recipient", ts=NOW
        )
        assert result.sender_out.volume("24h") == 1.25
    finally:
        await redis.aclose()


async def test_attempt_crossing_the_preflight_limit_is_not_scored_or_duplicated() -> None:
    redis = fakeredis.FakeAsyncRedis()
    velocity = VelocityCounters(redis, max_history_rows=4)
    key = f"{KEY_PREFIX}:out:sender"
    try:
        await redis.zadd(key, {f"prior-{i}:counterparty:1.00": NOW for i in range(4)})
        for _ in range(2):
            with pytest.raises(VelocityCapacityError, match="capacity"):
                await velocity.record_and_snapshot(
                    tx_id="crossing",
                    sender_id="sender",
                    recipient_id="recipient",
                    amount=10,
                    ts=NOW,
                )
        assert await redis.zcard(key) == 5
    finally:
        await redis.aclose()


async def test_write_only_restore_can_rebuild_an_overloaded_account() -> None:
    redis = fakeredis.FakeAsyncRedis()
    velocity = VelocityCounters(redis, max_history_rows=4)
    try:
        for index in range(6):
            await velocity.record_attempt(
                tx_id=str(index), sender_id="sender", recipient_id="recipient", amount=10, ts=NOW
            )
        assert await redis.zcard(f"{KEY_PREFIX}:out:sender") == 6
        with pytest.raises(VelocityCapacityError, match="capacity"):
            await velocity.snapshot(sender_id="sender", recipient_id="recipient", ts=NOW)
    finally:
        await redis.aclose()


async def test_overload_cannot_create_an_approval_or_release_an_expired_hold(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    ids = [uuid.uuid4() for _ in range(4)]
    async with session_factory() as session:
        session.add_all(
            Account(
                id=account,
                iin=f"90010130000{i}",
                iban=make_kz_iban(f"{i:013d}"),
                phone=f"+7701000000{i}",
                full_name=f"Synthetic {i}",
                device_id=f"device-{i}",
                avg_tx_amount=Decimal("25000"),
            )
            for i, account in enumerate(ids, start=1)
        )
        await session.commit()
    redis = fakeredis.FakeAsyncRedis()
    resources = Resources.build(Settings(), session_factory=session_factory, redis=redis)
    app = create_app(Settings(), resources)
    try:
        async with (
            app.router.lifespan_context(app),
            AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
        ):
            held = await client.post(
                "/api/v1/transfers/evaluate",
                json={
                    "sender_id": str(ids[0]),
                    "recipient_id": str(ids[1]),
                    "amount": "900000",
                    "context": {"active_call": True, "from_deposit": True},
                },
            )
            assert held.status_code == 200
            tx_id = uuid.UUID(held.json()["transaction_id"])
            assert held.json()["status"] == "cooling_off"
            async with session_factory() as session:
                tx = await session.get(Transaction, tx_id)
                assert tx is not None
                tx.cooling_until = datetime.now(UTC) - timedelta(seconds=1)
                await session.commit()
            await redis.zadd(
                f"{KEY_PREFIX}:out:{ids[0]}",
                {
                    f"overload-{index}:counterparty:10.00": datetime.now(UTC).timestamp()
                    for index in range(MAX_HISTORY_ROWS + 1)
                },
            )
            fresh = await client.post(
                "/api/v1/transfers/evaluate",
                json={
                    "sender_id": str(ids[0]),
                    "recipient_id": str(ids[1]),
                    "amount": "1000",
                },
            )
            assert fresh.status_code == 503
            answers = {
                "caller_claims_bank_or_police": False,
                "asked_to_move_to_safe_account": False,
                "asked_to_keep_secret_or_install_app": False,
                "initiated_by_customer": True,
                "knows_recipient_personally": True,
            }
            release = await client.post(
                f"/api/v1/transfers/{tx_id}/resolve-cooling", json={"answers": answers}
            )
            assert release.status_code == 503
            assert release.headers["retry-after"] == "60"
            async with session_factory() as session:
                tx = await session.get(Transaction, tx_id)
                assert tx is not None
                assert tx.status is TransactionStatus.COOLING_OFF
                assert tx.resolved_at is None
                assert tx.verification_answers is None
                assert await session.scalar(select(func.count()).select_from(Transaction)) == 1
                assert await session.scalar(select(func.count()).select_from(GraphEdge)) == 0
            assert (await client.get("/ready")).status_code == 200
            normal = await client.post(
                "/api/v1/transfers/evaluate",
                json={
                    "sender_id": str(ids[2]),
                    "recipient_id": str(ids[3]),
                    "amount": "1000",
                },
            )
            assert normal.status_code == 200
            assert normal.json()["status"] == "approved"
    finally:
        await redis.aclose()

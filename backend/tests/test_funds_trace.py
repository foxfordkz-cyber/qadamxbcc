from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.kz import make_kz_iban
from app.models import Account, Transaction, TransactionStatus
from app.services.funds_trace import MAX_CANDIDATES, funds_trace
from app.services.trace_anchors import recent_anchors
from tests.test_service_boundaries import SOC_KEY, TRANSFER_KEY
from tests.test_service_boundaries import secured_client as secured_client

START = datetime(2026, 1, 1, 12, tzinfo=UTC)


@pytest.fixture
async def ledger(session_factory: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        for number in range(1, 9):
            session.add(
                Account(
                    id=UUID(int=number),
                    iin=f"9001011{number:05d}",
                    iban=make_kz_iban(f"{number:013d}"),
                    phone=f"+7701{number:07d}",
                    full_name=f"Account {number}",
                    device_id=f"dev-{number}",
                )
            )
        await session.commit()
        yield session


def payment(
    session: AsyncSession,
    sender: int,
    recipient: int,
    amount: str,
    minute: int,
    *,
    status: TransactionStatus = TransactionStatus.APPROVED,
    resolved_minute: int | None = None,
    currency: str = "KZT",
) -> Transaction:
    result = Transaction(
        id=uuid4(),
        sender_id=UUID(int=sender),
        recipient_id=UUID(int=recipient),
        amount=Decimal(amount),
        device_id="synthetic",
        status=status,
        currency=currency,
        created_at=START + timedelta(minutes=minute),
        resolved_at=START + timedelta(minutes=resolved_minute)
        if resolved_minute is not None
        else None,
    )
    session.add(result)
    return result


async def test_partial_splits_merge_without_multiplying_the_anchor(ledger: AsyncSession) -> None:
    anchor = payment(ledger, 1, 2, "100.55", 0)
    a = payment(ledger, 2, 3, "60.05", 1)
    b = payment(ledger, 2, 4, "80", 2)
    c = payment(ledger, 3, 5, "60.05", 3)
    d = payment(ledger, 4, 5, "40.50", 4)
    e = payment(ledger, 5, 2, "130", 5)
    payment(ledger, 2, 6, "100", 6)  # completed cycle cannot create a fourth hop
    await ledger.flush()
    result = await funds_trace(ledger, anchor.id)
    assert result is not None
    assert result.outcome == "possible_flow"
    assert result.first_hop_amount == result.amount == Decimal("100.55")
    assert [(row.transaction_id, row.allocated_amount, row.last_hop) for row in result.links] == [
        (a.id, Decimal("60.05"), 1),
        (b.id, Decimal("40.50"), 1),
        (c.id, Decimal("60.05"), 2),
        (d.id, Decimal("40.50"), 2),
        (e.id, Decimal("100.55"), 3),
    ]
    assert result.links[-1].transaction_amount == 130


async def test_only_strictly_later_settlements_within_cutoff(ledger: AsyncSession) -> None:
    anchor = payment(ledger, 1, 2, "90", 0, resolved_minute=10)
    payment(ledger, 2, 3, "80", 5)  # before the anchor's actual release
    payment(ledger, 3, 4, "60", 11)  # reverse order
    payment(ledger, 2, 6, "90", 12, status=TransactionStatus.BLOCKED)
    payment(ledger, 2, 6, "90", 13, status=TransactionStatus.CANCELLED)
    payment(ledger, 2, 6, "90", 14, status=TransactionStatus.COOLING_OFF)
    payment(ledger, 2, 6, "90", 15, currency="USD")
    valid = payment(ledger, 2, 3, "50", 2, resolved_minute=16)
    next_day = payment(ledger, 3, 5, "50", 24 * 60 + 11)
    later = payment(ledger, 3, 5, "10", 19)
    await ledger.flush()
    short = await funds_trace(ledger, anchor.id, as_of=START + timedelta(minutes=18))
    assert short
    assert [item.transaction_id for item in short.links] == [valid.id]
    whole = await funds_trace(ledger, anchor.id, as_of=next_day.created_at)
    assert whole
    assert [item.transaction_id for item in whole.links] == [valid.id, later.id]
    assert whole.observed_until == START + timedelta(hours=24, minutes=10)


async def test_simultaneous_inflow_cannot_fund_same_time_outflow(ledger: AsyncSession) -> None:
    anchor = payment(ledger, 1, 2, "80", 0)
    payment(ledger, 2, 8, "20", 0)
    first = payment(ledger, 2, 3, "80", 5)
    payment(ledger, 3, 4, "80", 5)
    second = payment(ledger, 3, 5, "50", 6)
    await ledger.flush()
    result = await funds_trace(ledger, anchor.id)
    assert result
    assert result.ambiguous_count == 2
    assert [edge.transaction_id for edge in result.links] == [first.id, second.id]


async def test_competing_simultaneous_outflows_do_not_pick_a_recipient(
    ledger: AsyncSession,
) -> None:
    anchor = payment(ledger, 1, 2, "100", 0)
    payment(ledger, 2, 3, "80", 1)
    payment(ledger, 2, 4, "80", 1)
    payment(ledger, 2, 5, "40", 2)
    await ledger.flush()
    result = await funds_trace(ledger, anchor.id)
    assert result
    assert result.outcome == "insufficient_evidence"
    assert result.ambiguous_count == 2
    assert result.first_hop_amount == 0
    assert not result.links


async def test_candidate_limit_preserves_prefix_and_drops_cut_tie(ledger: AsyncSession) -> None:
    anchor = payment(ledger, 1, 2, "1000", 0)
    first = payment(ledger, 2, 3, "1", 1)
    for _ in range(MAX_CANDIDATES):
        payment(ledger, 2, 4, "1", 2)
    await ledger.flush()
    result = await funds_trace(ledger, anchor.id)
    assert result
    assert result.truncated
    assert result.candidates_examined <= MAX_CANDIDATES
    assert [edge.transaction_id for edge in result.links] == [first.id]


@pytest.mark.parametrize(
    "status",
    [TransactionStatus.COOLING_OFF, TransactionStatus.BLOCKED, TransactionStatus.CANCELLED],
)
async def test_non_settled_or_missing_transfer_has_no_flow(
    ledger: AsyncSession, status: TransactionStatus
) -> None:
    anchor = payment(ledger, 1, 2, "100", 0, status=status)
    payment(ledger, 2, 3, "100", 1)
    await ledger.flush()
    result = await funds_trace(ledger, anchor.id)
    assert result
    assert result.outcome == "not_settled"
    assert result.candidates_examined == 0
    assert result.settled_at is None
    assert not result.links
    assert await funds_trace(ledger, uuid4()) is None


async def test_ledger_endpoint_requires_soc_and_serializes_settled_evidence(
    ledger: AsyncSession, secured_client: AsyncClient
) -> None:
    anchor = payment(ledger, 1, 2, "120.00", 0)
    next_transfer = payment(ledger, 2, 3, "70.25", 1)
    await ledger.commit()
    path = f"/api/v1/soc/transfers/{anchor.id}/funds-trace"
    assert (await secured_client.get(path)).status_code == 401
    assert (
        await secured_client.get(path, headers={"X-BCC-API-Key": TRANSFER_KEY})
    ).status_code == 401
    headers = {"X-BCC-SOC-Key": SOC_KEY}
    response = await secured_client.get(path, headers=headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    payload = response.json()
    assert payload["first_hop_amount"] == "70.25"
    assert payload["links"][0]["transaction_id"] == str(next_transfer.id)
    assert payload["links"][0]["settled_at"].endswith("Z")
    unknown = await secured_client.get(
        f"/api/v1/soc/transfers/{uuid4()}/funds-trace", headers=headers
    )
    assert unknown.status_code == 404


async def test_anchors_use_last_64_receipts_and_offer_eight_in_settlement_order(
    ledger: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.services.trace_anchors.utcnow", lambda: START + timedelta(hours=5))
    old = payment(ledger, 1, 2, "80", 0, resolved_minute=200)
    others = [payment(ledger, 1, 2, "9", minute) for minute in range(1, 60)]
    released = payment(ledger, 3, 2, "80", 60, resolved_minute=190)
    payment(ledger, 1, 2, "90", 61, status=TransactionStatus.COOLING_OFF)
    payment(ledger, 1, 2, "90", 62, currency="USD")
    payment(ledger, 1, 2, "90", 63, resolved_minute=360)
    payment(ledger, 2, 2, "90", 64)
    payment(ledger, 1, 4, "90", 65)
    await ledger.flush()
    result = await recent_anchors(ledger, UUID(int=2))
    assert result.account_id == UUID(int=2)
    assert [entry.transaction_id for entry in result.items] == [
        released.id,
        *(entry.id for entry in reversed(others[-7:])),
    ]
    assert old.id not in {entry.transaction_id for entry in result.items}
    assert result.items[0].settled_at == released.resolved_at

from datetime import UTC
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.core.kz import iin_check_digit, is_valid_iin, is_valid_kz_iban, make_kz_iban
from app.models import Account, RiskEvent, Transaction, TransactionStatus


def _account(n: int, device: str = "dev-A") -> Account:
    return Account(
        iin=f"9001011{n:05d}",
        iban=make_kz_iban(f"{n:013d}"),
        phone=f"+7701{n:07d}",
        full_name=f"Test User {n}",
        device_id=device,
        avg_tx_amount=Decimal("25000.00"),
    )


async def test_transaction_roundtrip_with_risk_events(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        sender, recipient = _account(1), _account(2)
        session.add_all([sender, recipient])
        await session.flush()
        tx = Transaction(
            sender_id=sender.id,
            recipient_id=recipient.id,
            amount=Decimal("150000.00"),
            status=TransactionStatus.COOLING_OFF,
            risk_score=55,
            latency_ms=4.2,
            device_id="dev-A",
            active_call=True,
        )
        tx.risk_events = [
            RiskEvent(
                layer="behavioral",
                rule_code="ACTIVE_CALL",
                score_delta=30,
                reason_kk="Белсенді қоңырау",
                reason_ru="Активный звонок",
            )
        ]
        session.add(tx)
        await session.commit()
        tx_id = tx.id

    async with session_factory() as session:
        loaded = (
            await session.execute(
                select(Transaction)
                .where(Transaction.id == tx_id)
                .options(selectinload(Transaction.risk_events))
            )
        ).scalar_one()
    assert loaded.status is TransactionStatus.COOLING_OFF
    assert loaded.created_at.tzinfo is UTC
    assert loaded.amount == Decimal("150000.00")
    assert [e.rule_code for e in loaded.risk_events] == ["ACTIVE_CALL"]


async def test_amount_must_be_positive(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory() as session:
        a, b = _account(3), _account(4)
        session.add_all([a, b])
        await session.flush()
        session.add(
            Transaction(
                sender_id=a.id,
                recipient_id=b.id,
                amount=Decimal("0"),
                status=TransactionStatus.APPROVED,
                device_id="dev-A",
            )
        )
        with pytest.raises(IntegrityError):
            await session.commit()


def test_kz_identifiers() -> None:
    iban = make_kz_iban("0000000000001")
    assert iban.startswith("KZ")
    assert iban[4:7] == "856"
    assert len(iban) == 20
    assert is_valid_kz_iban(iban)
    assert not is_valid_kz_iban(iban[:-1] + ("2" if iban[-1] != "2" else "3"))
    check = iin_check_digit("90010130001")
    assert check is not None
    assert is_valid_iin(f"90010130001{check}")
    assert not is_valid_iin(f"90010130001{(check + 1) % 10}")
    assert not is_valid_iin("901301300015")  # month 13
    assert not is_valid_iin("12345")

import uuid
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Account
from scripts.bootstrap_demo import is_empty


async def test_bootstrap_detects_existing_data_without_overwriting(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    assert await is_empty(session_factory)
    account_id = uuid.uuid4()
    async with session_factory() as session:
        session.add(
            Account(
                id=account_id,
                iin="000000000000",
                iban="KZ000000000000000001",
                phone="+77019999999",
                full_name="Existing Account",
                device_id="existing-device",
                avg_tx_amount=Decimal("25000"),
            )
        )
        await session.commit()
    assert not await is_empty(session_factory)
    async with session_factory() as session:
        account = await session.get(Account, account_id)
        assert account is not None
        assert account.full_name == "Existing Account"

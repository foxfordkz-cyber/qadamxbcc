import uuid
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.base import utcnow
from app.models import Account
from app.schemas.transfers import BankSessionObservation
from app.services.network_context import ingest, signals


async def test_trusted_session_history_and_household(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as db:
        accounts = [
            Account(
                iin=f"{i:012}",
                iban=f"KZ{i:018}",
                phone=f"+7700000000{i}",
                full_name=f"Fixture {i}",
                device_id=f"device-{i}",
            )
            for i in range(3)
        ]
        db.add_all(accounts)
        await db.commit()
        sender, recipient, _ = accounts
        now = utcnow()

        def event(
            who: Account, days: int, country: str, city: str | None, network: str
        ) -> BankSessionObservation:
            return BankSessionObservation(
                id=uuid.uuid4(),
                account_id=who.id,
                network_token=network * 64,
                country=country,
                city=city,
                observed_at=now - timedelta(days=days),
            )

        assert await signals(db, sender, recipient, now) == (0, None)
        for days in (6, 3):
            await ingest(db, event(sender, days, "KZ", None, "b"))
        last = event(sender, 0, "KZ", "ALA", "a")
        await ingest(db, last)
        await ingest(db, last)
        with pytest.raises(HTTPException) as conflict:
            await ingest(db, last.model_copy(update={"country": "UZ"}))
        assert conflict.value.status_code == 409
        await ingest(db, event(recipient, 0, "KZ", "ALA", "a"))
        assert await signals(db, sender, recipient, utcnow()) == (2, None)
        await ingest(db, event(sender, 4, "KZ", "AST", "d"))
        assert await signals(db, sender, recipient, utcnow()) == (2, "city")
        away = event(sender, 0, "UZ", "TAS", "b").model_copy(update={"observed_at": utcnow()})
        await ingest(db, away)
        assert await signals(db, sender, recipient, utcnow()) == (0, "country")
        assert await signals(db, sender, recipient, now - timedelta(days=1)) == (0, None)
        with pytest.raises(HTTPException) as invalid:
            await ingest(db, event(sender, -1, "KZ", "AST", "a"))
        assert invalid.value.status_code == 422

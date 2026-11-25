"""Run the same client/Guardian/SOC contract on real PostgreSQL row locks."""

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tests.test_jury_hold_review import test_review_roundtrip as exercise_review
from tests.test_mobile_gateway import mobile_world as mobile_world
from tests.test_postgres_concurrency import session_factory as session_factory


@pytest.mark.parametrize("trigger", ["appeal", "deadline", "suspicion"])
async def test_postgres_review_roundtrip(
    mobile_world: tuple[AsyncClient, Any],
    session_factory: async_sessionmaker[AsyncSession],
    trigger: str,
) -> None:
    await exercise_review(mobile_world, session_factory, trigger)

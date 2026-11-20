"""Exercise competing consent decisions on independent database connections."""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine

from app.db.base import Base
from app.db.session import build_engine
from tests.test_case_callbacks import BASE, GUARDIAN, act, keyed, opened
from tests.test_mobile_gateway import mobile_world as mobile_world


@pytest.fixture
async def db_engine(db_engine: AsyncEngine, tmp_path: Path) -> AsyncIterator[AsyncEngine]:
    if db_engine.dialect.name == "postgresql":
        yield db_engine
        return
    # A shared :memory: connection would put both clients in the same transaction.
    disk = build_engine(f"sqlite+aiosqlite:///{(tmp_path / 'callbacks.db').as_posix()}")
    try:
        async with disk.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield disk
    finally:
        await disk.dispose()


async def test_competing_answers_record_only_one_consent(
    mobile_world: tuple[AsyncClient, Any],
) -> None:
    client, _ = mobile_world
    owner, officer, _, cid, _ = await opened(client)
    version = await act(client, cid, officer, action="assign", assignee="demo_analyst_a")
    invitation = await client.post(
        BASE + f"/cases/{cid}/callback", headers=keyed(officer), json={"expected_version": version}
    )
    assert invitation.status_code == 200
    reply = BASE + f"/callbacks/{invitation.json()['id']}/answer"
    answers = await asyncio.gather(
        *[
            client.post(reply, headers=keyed(owner), json={"answer": decision})
            for decision in ("accepted", "declined")
        ]
    )
    assert sorted(r.status_code for r in answers) == [200, 409]
    winner = next(r for r in answers if r.status_code == 200)
    view = await client.get(BASE + f"/cases/{cid}/callback", headers=officer)
    assert view.json()["callback"] == winner.json()
    history = await client.get(GUARDIAN + f"/soc/cases/{cid}/history", headers=officer)
    assert (
        sum(
            e["code"] in {"CALLBACK_ACCEPTED", "CALLBACK_DECLINED"} for e in history.json()["items"]
        )
        == 1
    )

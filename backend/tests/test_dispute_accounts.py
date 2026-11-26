import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import get_session
from app.db.base import utcnow
from app.mobile_gateway import jury_rooms
from app.mobile_gateway.app import Identity, identity, session_key
from app.mobile_gateway.jury_interview import install_jury_interview
from app.mobile_gateway.jury_rooms import create_jury_app
from app.models import PaymentReturn, Transaction, TransactionStatus
from tests.test_mobile_gateway import ADMIN_CODE, OTHER, OWNER, PLATFORM_CODE, login
from tests.test_mobile_gateway import mobile_world as mobile_world


async def test_payment_statements_are_party_scoped_and_soc_compares(
    mobile_world: tuple[AsyncClient, Any], session_factory: async_sessionmaker[AsyncSession]
) -> None:
    http, redis = mobile_world
    sender = await login(http)
    officer = await login(http, ADMIN_CODE)
    platform = await login(http, PLATFORM_CODE)

    async def other_subject(subject: Any) -> dict[str, str]:
        token = secrets.token_urlsafe(40)
        await redis.set(
            session_key(token), Identity(role="client", subject=subject).model_dump_json(), ex=60
        )
        return {"Authorization": "Bearer " + token}

    recipient, outsider = await other_subject(OTHER), await other_subject(uuid4())
    tx_id = uuid4()
    async with session_factory() as db:
        db.add(
            Transaction(
                id=tx_id,
                sender_id=OWNER,
                recipient_id=OTHER,
                amount=Decimal("25000"),
                status=TransactionStatus.APPROVED,
                device_id="test",
            )
        )
        await db.commit()
        path = "/mobile/v1/wallet/participant-statements/" + str(tx_id)
        assert (await http.get(path, headers=sender)).status_code == 404
        db.add(PaymentReturn(original_id=tx_id, reported_at=utcnow()))
        await db.commit()
    assert (await http.get(path, headers=outsider)).status_code == 404
    assert (await http.get(path, headers=platform)).status_code == 403
    assert (await http.post(path + "/jury-invite", headers=officer)).status_code == 404
    one = {"answer": "agreed"}
    two = {"answer": "redirect_requested"}
    assert (await http.post(path, json=one, headers=officer)).status_code == 403
    first = await http.post(path, json=one, headers=sender)
    assert first.status_code == 200
    assert "recipient" not in first.json()
    assert (await http.post(path, json=one, headers=sender)).json() == first.json()
    assert (await http.post(path, json=two, headers=sender)).status_code == 409
    second = await http.post(path, json=two, headers=recipient)
    assert second.status_code == 200
    assert "sender" not in second.json()
    both = (await http.get(path, headers=officer)).json()
    assert both["sender"]["answer"] == one["answer"]
    assert both["recipient"]["answer"] == two["answer"]
    assert "recipient" not in (await http.get(path, headers=sender)).json()


async def test_jury_invite_binds_one_party_and_dispute(
    mobile_world: tuple[AsyncClient, Any],
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, redis = mobile_world
    room = FastAPI()
    room.state.resources = SimpleNamespace(redis=redis)

    async def session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as db:
            yield db

    room.dependency_overrides[get_session] = session
    person = Identity(role="client", subject=OWNER)
    room.dependency_overrides[identity] = lambda: person
    install_jury_interview(room, OWNER)
    tx = uuid4()
    async with session_factory() as db:
        db.add(
            Transaction(
                id=tx,
                sender_id=OTHER,
                recipient_id=OWNER,
                amount=Decimal("7000"),
                status=TransactionStatus.APPROVED,
                device_id="jury",
            )
        )
        await db.commit()
        db.add(PaymentReturn(original_id=tx, reported_at=utcnow()))
        await db.commit()
    path = f"/mobile/v1/wallet/participant-statements/{tx}/jury-invite"
    async with AsyncClient(transport=ASGITransport(app=room), base_url="http://fixture") as browser:
        submit = "/mobile/v1/wallet/jury-interview"
        assert (await browser.post(path)).status_code == 403
        person = Identity(role="admin", subject=uuid4())
        result = await browser.post(path)
        assert result.status_code == 200
        ident, code = result.json()["fragment"].split(".")
        body = {"transfer": ident, "code": code, "answer": "unexpected"}
        assert (
            await browser.post(submit, json={**body, "transfer": str(uuid4())})
        ).status_code == 403
        accepted = await browser.post(submit, json=body)
        assert accepted.json()["audience"] == "sender"
        assert "recipient" not in accepted.json()
        assert accepted.json()["sender"]["source"] == "jury_invite"
        assert (await browser.post(submit, json=body)).json() == accepted.json()
        assert (await browser.post(submit, json={**body, "answer": "agreed"})).status_code == 409
        await browser.post(path)
        assert (await browser.post(submit, json=body)).status_code == 403

    @asynccontextmanager
    async def room_factory(_: int) -> AsyncIterator[FastAPI]:
        yield room

    (tmp_path / "counterparty.html").write_text("scoped guest form", encoding="utf8")
    monkeypatch.setattr(jury_rooms, "WEB_ASSETS", tmp_path)
    gateway = create_jury_app(room_factory)
    site = "https://jury.example"
    async with (
        AsyncClient(transport=ASGITransport(app=gateway), base_url=site) as officer,
        AsyncClient(transport=ASGITransport(app=gateway), base_url=site) as guest,
    ):
        assert (await officer.post("/jury/start", headers={"Origin": site})).is_redirect
        issued = (await officer.post(path)).json()
        headers = {"Origin": site, "X-Saq-Interview": issued["routing"]}
        body = {**body, "code": issued["fragment"].split(".")[1]}
        assert not guest.cookies
        assert (await guest.get("/jury/interview/counterparty.html")).text == "scoped guest form"
        assert (await guest.get("/jury/interview/index.html")).status_code == 404
        assert (
            await guest.post(
                submit, json=body, headers={**headers, "Origin": "https://other.example"}
            )
        ).status_code == 403
        assert (await guest.get("/mobile/v1/account", headers=headers)).status_code == 403
        assert (
            await guest.post(submit, json=body, headers={**headers, "X-Saq-Interview": "expired"})
        ).status_code == 403
        reply = await guest.post(submit, json=body, headers=headers)
        assert reply.status_code == 200
        assert reply.json()["sender"]["source"] == "jury_invite"
        assert not guest.cookies
        await officer.post(path)
        assert (await guest.post(submit, json=body, headers=headers)).status_code == 403

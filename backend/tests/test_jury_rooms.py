import asyncio
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from starlette.types import ASGIApp

from app.mobile_gateway.jury_rooms import (
    IDLE_SECONDS,
    MAX_ROOMS,
    ROOM_COOKIE,
    RoomPool,
    create_jury_app,
)

BASE = "https://jury.test"
ORIGIN = {"Origin": BASE}


class Stores:
    def __init__(self) -> None:
        self.started: list[int] = []
        self.closed: list[int] = []

    @asynccontextmanager
    async def factory(self, slot: int) -> AsyncIterator[ASGIApp]:
        self.started.append(slot)
        notes: list[str] = []
        wallet = FastAPI()

        @wallet.get("/mobile/v1/notes")
        async def read() -> list[str]:
            return notes

        @wallet.post("/mobile/v1/notes")
        async def write(value: str) -> None:
            notes.append(value)

        try:
            yield wallet
        finally:
            self.closed.append(slot)


async def test_private_rooms_only_start_by_same_origin_post_and_join_by_invitation() -> None:
    stores = Stores()
    app = create_jury_app(stores.factory)
    transport = ASGITransport(app=app)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=transport, base_url=BASE) as alice,
        AsyncClient(transport=transport, base_url=BASE) as bob,
        AsyncClient(transport=transport, base_url=BASE) as guest,
    ):
        assert (await alice.head("/health")).status_code == 200
        assert (await alice.get("/health")).json()["status"] == "ok"
        welcome = await alice.get("/")
        assert welcome.status_code == 200
        assert "<details><summary>" in welcome.text
        assert all(
            f"SaqBol-{role}-2026" in welcome.text for role in ("Client", "Officer", "Platform")
        )
        assert (await alice.get("/wallet/")).headers["location"] == "/jury"
        assert (await alice.get("/mobile/v1")).status_code == 401
        assert (await alice.get("/jury/join/invalid")).status_code == 404
        assert (await alice.post("/jury/start")).status_code == 403
        assert (
            await alice.post("/jury/start", headers={"Origin": "https://other.test"})
        ).status_code == 403
        assert stores.started == []
        first = await alice.post("/jury/start", headers=ORIGIN)
        assert first.status_code == 303
        assert first.headers["location"] == "/wallet/"
        cookie = next(v for v in first.headers.get_list("set-cookie") if v.startswith(ROOM_COOKIE))
        assert all(flag in cookie for flag in ("Secure", "HttpOnly", "SameSite=lax", "Path=/"))
        second = await alice.post("/jury/start", headers=ORIGIN)
        assert second.status_code == 303
        assert stores.started == [1]
        assert (await alice.get("/wallet/install/Saq-Bol-Android-2.6.apk")).status_code == 404
        assert (await alice.post("/mobile/v1/notes?value=case-A")).status_code == 200
        home = await alice.get("/")
        assert home.headers["Cache-Control"] == "no-store"
        assert home.headers["Referrer-Policy"] == "same-origin"
        invite = re.search(r'href="(/jury/join/[A-Za-z0-9_-]{43})"', home.text)
        assert invite is not None
        assert (await guest.get("/mobile/v1/notes")).status_code == 401
        await bob.post("/jury/start", headers=ORIGIN)
        assert (await bob.get("/mobile/v1/notes")).json() == []
        await bob.post("/mobile/v1/notes?value=case-B")
        joined = await bob.get(invite[1])
        assert joined.status_code == 303
        assert joined.headers["Referrer-Policy"] == "no-referrer"
        assert any(
            "__Host-qadam-session=" in v and "Max-Age=0" in v
            for v in joined.headers.get_list("set-cookie")
        )
        assert (await bob.get("/mobile/v1/notes")).json() == ["case-A"]
        assert (await alice.get("/mobile/v1/notes")).json() == ["case-A"]
    assert sorted(stores.closed) == [1, 2]


async def test_expires_only_idle_rooms_and_fully_releases_slot_before_reuse() -> None:
    stores = Stores()
    now = 0
    pool = RoomPool(stores.factory, clock=lambda: now)
    keys = await asyncio.gather(*(pool.create() for _ in range(MAX_ROOMS)))
    assert len(set(keys)) == MAX_ROOMS
    assert await pool.create() is None
    with pool.borrow(keys[0]) as leased:
        assert leased is not None
        now = IDLE_SECONDS
        await asyncio.gather(pool.reap(), pool.reap())
        assert sorted(stores.closed) == list(range(2, MAX_ROOMS + 1))
        with pool.borrow(keys[-1]) as old:
            assert old is None
        new_key = await pool.create()
        assert new_key
        assert new_key not in keys
        with pool.borrow(new_key) as fresh:
            assert fresh is not None
            assert fresh.slot == 2
        assert leased.slot == 1
    now += IDLE_SECONDS - 1
    await pool.reap()
    assert len(pool.rooms) == 2
    now += 1
    await pool.reap()
    assert not pool.rooms
    assert sorted(pool.free) == list(range(1, MAX_ROOMS + 1))


async def test_slow_start_and_close_do_not_allocate_a_busy_slot() -> None:
    opening = asyncio.Event()
    closing = asyncio.Event()
    started = asyncio.Event()
    stopping = asyncio.Event()
    now = 0

    @asynccontextmanager
    async def factory(slot: int) -> AsyncIterator[ASGIApp]:
        if slot == 1:
            started.set()
            await opening.wait()
        yield FastAPI()
        if slot == 1:
            stopping.set()
            await closing.wait()

    pool = RoomPool(factory, clock=lambda: now)
    first = asyncio.create_task(pool.create())
    await started.wait()
    others = await asyncio.gather(*(pool.create() for _ in range(MAX_ROOMS)))
    assert others.count(None) == 1
    opening.set()
    assert await first
    now = IDLE_SECONDS
    release = asyncio.create_task(pool.reap())
    await stopping.wait()
    assert 1 not in pool.free
    release.cancel()
    with pytest.raises(asyncio.CancelledError):
        await release
    closing.set()
    await pool.reap()
    assert 1 in pool.free


async def test_capacity_and_failed_entry_return_retry_with_no_slot_leak() -> None:
    stores = Stores()
    attempts = 0

    @asynccontextmanager
    async def flaky(slot: int) -> AsyncIterator[ASGIApp]:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("Synthetic failed entry")
        async with stores.factory(slot) as room:
            yield room

    async def not_ready() -> bool:
        return False

    app = create_jury_app(flaky, ready=not_ready)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url=BASE) as client,
    ):
        assert (await client.get("/health")).status_code == 503
        assert attempts == 0
        failed = await client.post("/jury/start", headers=ORIGIN)
        assert failed.status_code == 503
        for _ in range(MAX_ROOMS):
            client.cookies.clear()
            assert (await client.post("/jury/start", headers=ORIGIN)).status_code == 303
        client.cookies.clear()
        full = await client.post("/jury/start", headers=ORIGIN)
        assert full.status_code == 503
        assert full.headers["retry-after"] == "60"
        assert "Бөлме" in full.text
    assert stores.closed == list(range(1, MAX_ROOMS + 1))


async def test_failed_teardown_retires_its_slot() -> None:
    @asynccontextmanager
    async def fails_on_close(slot: int) -> AsyncIterator[ASGIApp]:
        yield FastAPI()
        if slot == 1:
            raise RuntimeError("Synthetic teardown failure")

    now = 0
    pool = RoomPool(fails_on_close, clock=lambda: now)
    assert await pool.create()
    now = IDLE_SECONDS
    await pool.reap()
    assert 1 not in pool.free
    key = await pool.create()
    with pool.borrow(key) as different:
        assert different is not None
        assert different.slot == 2
    await pool.reap(shutdown=True)


async def test_shutdown_waits_for_live_requests_and_stops_allocation() -> None:
    stores = Stores()
    pool = RoomPool(stores.factory)
    key = await pool.create()
    with pool.borrow(key) as room:
        assert room
        stopping = asyncio.create_task(pool.reap(shutdown=True))
        await asyncio.sleep(0)
        assert pool.stopping
        assert await pool.create() is None
        assert not stores.closed
    await stopping
    assert stores.closed == [1]

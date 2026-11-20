import asyncio
import os
import shutil
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from tempfile import TemporaryDirectory

import fakeredis
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError

from app.mobile_gateway.config import MobileSettings
from app.mobile_gateway.passwords import encode
from scripts.jury_wallet import JuryStorage, private_redis

BASE = "/mobile/v1"


async def sign_in(http: AsyncClient, login: str, password: str) -> dict[str, str]:
    reply = await http.post(BASE + "/auth/login", json={"login": login, "password": password})
    assert reply.status_code == 200
    return {"Authorization": "Bearer " + reply.json()["token"]}


@pytest.fixture(params=["memory", "unix"])
async def connect(request: pytest.FixtureRequest) -> AsyncIterator[Callable[[int], Redis]]:
    if request.param == "memory":
        server = fakeredis.FakeServer()
        yield lambda slot: fakeredis.FakeAsyncRedis(server=server, db=slot)
        return
    if os.name == "nt" or not shutil.which("redis-server"):
        pytest.skip("A private redis-server with Unix sockets is required")
    # Always launch a dedicated daemon. A slot must never flush an ambient test database.
    with TemporaryDirectory(prefix="saq-test-") as folder, private_redis(Path(folder)) as socket:

        def client(slot: int) -> Redis:
            return Redis(unix_socket_path=str(socket), db=slot)

        async with client(0) as readiness:
            async with asyncio.timeout(10):
                while True:
                    try:
                        await readiness.ping()
                        break
                    except RedisConnectionError:
                        await asyncio.sleep(0.05)
        yield client


def jury_storage(directory: Path, connect: Callable[[int], Redis]) -> JuryStorage:
    mobile = MobileSettings(
        enabled=True,
        auth_mode="password",
        ephemeral_store=True,
        client_hash=SecretStr(encode("customer fixture")),
        admin_hash=SecretStr(encode("officer fixture")),
        platform_hash=SecretStr(encode("platform fixture")),
    )
    return JuryStorage(directory, connect, mobile)


@pytest.fixture
def rooms(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    from app.mobile_gateway import app as gateway

    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "index.html").write_text("<html data-web-wallet data-install></html>")
    monkeypatch.setattr(gateway, "WEB_ASSETS", assets)
    directory = tmp_path / "rooms"
    directory.mkdir()
    return directory


async def test_active_rooms_and_reused_slot_isolate_sessions_sql_and_risk_state(
    rooms: Path,
    connect: Callable[[int], Redis],
) -> None:
    storage = jury_storage(rooms, connect)
    async with (
        storage.room(2) as second,
        AsyncClient(transport=ASGITransport(app=second), base_url="http://local") as other,
    ):
        async with (
            storage.room(1) as first,
            AsyncClient(transport=ASGITransport(app=first), base_url="http://local") as http,
        ):
            for url in ("/wallet/", "/wallet/index.html"):
                shell = await http.get(url)
                assert shell.status_code == 200
                assert "data-web-wallet" in shell.text
                assert "data-install" not in shell.text
            customer = await sign_in(http, "client_demo", "customer fixture")
            officer = await sign_in(http, "admin_demo", "officer fixture")
            platform = await sign_in(http, "platform_demo", "platform fixture")
            staff = (await http.get(BASE + "/admin/staff", headers=platform)).json()["items"][0]
            change = await http.patch(
                BASE + "/admin/staff/" + staff["subject"],
                headers=platform,
                json={"enabled": False, "expected_version": staff["version"]},
            )
            assert change.status_code == 200
            assert (await http.get(BASE + "/session", headers=officer)).status_code == 401
            assert (await other.get(BASE + "/session", headers=customer)).status_code == 401
            await sign_in(other, "admin_demo", "officer fixture")
            first.state.resources.engine.graph.add_account("only-first", label="fixture")
            await first.state.resources.redis.set("velocity-fixture", "1")
            assert await second.state.resources.redis.get("velocity-fixture") is None
            assert "only-first" not in second.state.resources.engine.graph
            assert second.state.resources.engine.model is first.state.resources.engine.model
            with pytest.raises(ValueError, match="active"):
                async with storage.room(1):
                    pytest.fail("A live slot cannot be reset")

        async with (
            storage.room(1) as replacement,
            AsyncClient(transport=ASGITransport(app=replacement), base_url="http://local") as fresh,
        ):
            assert (await fresh.get(BASE + "/session", headers=customer)).status_code == 401
            assert await replacement.state.resources.redis.get("velocity-fixture") is None
            assert "only-first" not in replacement.state.resources.engine.graph
            await sign_in(fresh, "admin_demo", "officer fixture")
            platform = await sign_in(fresh, "platform_demo", "platform fixture")
            assert (await fresh.get(BASE + "/admin/staff", headers=platform)).json()["audit"] == []
    assert await asyncio.to_thread(lambda: list(rooms.iterdir())) == []

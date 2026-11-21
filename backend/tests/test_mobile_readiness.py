from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy.exc import OperationalError

from app.core.config import Settings
from app.mobile_gateway.app import create_mobile_app
from app.mobile_gateway.config import MobileSettings
from app.mobile_gateway.readiness import install_readiness


@pytest.mark.parametrize("dependency", ["database", "redis", "timeout", "healthy"])
async def test_readiness_is_bounded_cached_and_recovers(dependency: str) -> None:
    app = FastAPI()
    session = AsyncMock()
    factory = MagicMock()
    factory.return_value.__aenter__.return_value = session
    redis = AsyncMock()
    app.state.resources = SimpleNamespace(session_factory=factory, redis=redis)
    install_readiness(app)
    if dependency == "database":
        session.execute.side_effect = OperationalError("private connection", {}, Exception())
    elif dependency == "redis":
        redis.ping.side_effect = RedisConnectionError("private redis endpoint")
    elif dependency == "timeout":
        redis.ping.side_effect = TimeoutError()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        with patch("app.mobile_gateway.readiness.time.monotonic", return_value=100):
            first = await client.get("/ready")
            again = await client.get("/ready")
        assert first.status_code == (200 if dependency == "healthy" else 503)
        assert first.json() == {"status": "ready" if dependency == "healthy" else "unavailable"}
        assert first.headers["cache-control"] == "no-store"
        assert again.json() == first.json()
        assert session.execute.await_count == 1
        session.execute.side_effect = redis.ping.side_effect = None
        with patch("app.mobile_gateway.readiness.time.monotonic", return_value=106):
            assert (await client.get("/ready")).status_code == 200
        assert session.execute.await_count == 2


@pytest.mark.parametrize("browser_only", [False, True])
async def test_public_release_routes_do_not_publish_missing_apk_or_grant_soc(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    browser_only: bool,
) -> None:
    monkeypatch.setattr("app.mobile_gateway.app.WEB_ASSETS", tmp_path)
    (tmp_path / "index.html").write_text("test wallet", encoding="utf-8")
    app = create_mobile_app(
        MobileSettings(
            enabled=True,
            client_code=SecretStr("synthetic-client-code-1234567890ABC"),
            admin_code=SecretStr("synthetic-admin-code-0987654321XYZ"),
        ),
        Settings(database_url="sqlite+aiosqlite:///:memory:"),
        browser_only=browser_only,
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/")).headers["location"] == "/wallet/"
        (tmp_path / "release.html").write_text("synthetic release<!-- android-download -->")
        assert (await client.get("/")).text == "synthetic release"
        assert (await client.get("/wallet/")).text == "test wallet"
        soc = await client.get("/soc/")
        assert soc.status_code == 307
        assert soc.headers["location"] == "/wallet/"
        assert "set-cookie" not in soc.headers
        assert (await client.get("/download/")).status_code == 503
        install = tmp_path / "install"
        install.mkdir()
        (install / "release.json").write_text('{"apk":"Saq-Bol-Android-2.7.apk","bytes":1}')
        (install / "index.html").write_text("installer")
        assert (await client.get("/download/")).status_code == 503
        (install / "Saq-Bol-Android-2.7.apk").write_bytes(b"x")
        download = await client.get("/download/")
        if browser_only:
            assert download.status_code == 503
            assert "/download/" not in (await client.get("/")).text
        else:
            assert download.headers["location"] == "/wallet/install/"
            assert 'href="/download/"' in (await client.get("/")).text

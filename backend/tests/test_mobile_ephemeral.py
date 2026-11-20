import uuid
from pathlib import Path
from typing import Any

import fakeredis
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from app.core.config import Settings, get_settings
from app.core.resources import Resources
from app.integrations.config import IntegrationSettings
from app.mobile_gateway.app import create_mobile_app
from app.mobile_gateway.config import MobileSettings
from app.mobile_gateway.passwords import encode
from scripts import mobile_ephemeral


async def test_disposable_store_supports_cross_role_transfer_and_isolation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    server = fakeredis.FakeServer()
    monkeypatch.setenv("BCC_ENVIRONMENT", "demo")
    monkeypatch.setenv("BCC_DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'mobile.db'}")
    monkeypatch.setattr(
        mobile_ephemeral.Redis,
        "from_url",
        lambda *a, **k: fakeredis.FakeAsyncRedis(server=server),
    )
    get_settings.cache_clear()
    try:
        await mobile_ephemeral.prepare()
        settings = Settings()
        resources = Resources.build(settings)
        roles = {"client": "test-client-password", "admin": "test-officer-password"}
        cfg = MobileSettings(
            enabled=True,
            auth_mode="password",
            ephemeral_store=True,
            client_hash=SecretStr(encode(roles["client"])),
            admin_hash=SecretStr(encode(roles["admin"])),
        )
        app = create_mobile_app(cfg, settings, resources, IntegrationSettings())
        async with (
            app.router.lifespan_context(app),
            AsyncClient(transport=ASGITransport(app), base_url="http://test") as http,
        ):
            assert (await http.get("/health")).json()["ephemeral_store"] is True
            headers: dict[str, dict[str, str]] = {}
            for role, password in roles.items():
                response = await http.post(
                    "/mobile/v1/auth/login",
                    json={
                        "login": f"{role}_demo",
                        "password": password,
                    },
                )
                assert response.status_code == 200
                headers[role] = {"Authorization": "Bearer " + response.json()["token"]}
            request_id = str(uuid.uuid4())
            payload: dict[str, Any] = {
                "recipient_phone": "+77010000002",
                "amount": "1250",
                "request_id": request_id,
            }
            evaluated = await http.post(
                "/mobile/v1/api/transfers/evaluate", json=payload, headers=headers["client"]
            )
            assert evaluated.status_code == 200
            assert evaluated.json()["status"] == "approved"
            feed = "/mobile/v1/api/soc/feed"
            assert (await http.get(feed)).status_code == 401
            assert (await http.get(feed, headers=headers["client"])).status_code == 403
            rows = (await http.get(feed, headers=headers["admin"])).json()["items"]
            assert request_id in {row["transaction_id"] for row in rows}
    finally:
        get_settings.cache_clear()

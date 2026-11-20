import asyncio
import json
import secrets
from typing import Any
from uuid import UUID

import fakeredis
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.resources import Resources
from app.integrations.config import IntegrationSettings
from app.mobile_gateway.app import create_mobile_app, session_key
from app.mobile_gateway.config import MobileSettings
from app.mobile_gateway.passwords import encode
from tests.test_mobile_gateway import ADMIN_CODE, OWNER, PLATFORM_CODE, login
from tests.test_mobile_gateway import mobile_world as mobile_world

STAFF = "/mobile/v1/admin/staff"
SESSION = "/mobile/v1/session"
OFFICER = UUID("00000000-0000-4000-8000-000000000099")


async def test_access_changes_revoke_legacy_and_current_sessions(
    mobile_world: tuple[AsyncClient, Any],
) -> None:
    http, redis = mobile_world
    owner = await login(http)
    officer = await login(http, ADMIN_CODE)
    platform = await login(http, PLATFORM_CODE)
    actor = (await http.get(SESSION, headers=platform)).json()
    assert actor["role"] == "platform_admin"
    old_token = secrets.token_urlsafe(32)
    await redis.set(session_key(old_token), json.dumps({"subject": str(OFFICER), "role": "admin"}))
    legacy = {"Authorization": f"Bearer {old_token}"}
    assert (await http.get(SESSION, headers=legacy)).status_code == 200

    for forbidden in (owner, officer, legacy):
        assert (await http.get(STAFF, headers=forbidden)).status_code == 403
        assert (await http.get("/mobile/v1/admin/metrics", headers=forbidden)).status_code == 403
        assert (
            await http.patch(
                f"{STAFF}/{OFFICER}",
                headers=forbidden,
                json={"enabled": False, "expected_version": 0},
            )
        ).status_code == 403
    for route in ("account", "wallet/cases", "api/soc/feed", "api/trusted-contacts"):
        assert (await http.get("/mobile/v1/" + route, headers=platform)).status_code == 403
    assert (await http.post("/mobile/v1/requests", headers=platform)).status_code == 403

    async def set_access(subject: str, enabled: bool, revision: int) -> int:
        return (
            await http.patch(
                f"{STAFF}/{subject}",
                headers=platform,
                json={"enabled": enabled, "expected_version": revision},
            )
        ).status_code

    initial = (await http.get(STAFF, headers=platform)).json()
    assert initial["items"] == [
        {
            "subject": str(OFFICER),
            "login": "admin_demo",
            "role": "officer",
            "enabled": True,
            "version": 0,
        }
    ]
    assert initial["audit"] == []
    assert await set_access(actor["subject"], False, 0) == 404
    assert await set_access(str(OWNER), True, 0) == 404
    raced = await asyncio.gather(
        set_access(str(OFFICER), False, 0), set_access(str(OFFICER), False, 0)
    )
    assert sorted(raced) == [200, 409]
    assert await set_access(str(OFFICER), True, 0) == 409
    for revoked in (officer, legacy):
        assert (await http.get("/mobile/v1/api/soc/feed", headers=revoked)).status_code == 401
    assert (await http.post("/mobile/v1/sessions", json={"code": ADMIN_CODE})).status_code == 403
    assert await set_access(str(OFFICER), True, 1) == 200
    assert await set_access(str(OFFICER), True, 2) == 200
    assert (await http.get(SESSION, headers=officer)).status_code == 401
    assert (await http.get(SESSION, headers=legacy)).status_code == 401
    assert (
        await http.get("/mobile/v1/api/soc/feed", headers=await login(http, ADMIN_CODE))
    ).status_code == 200
    audit = (await http.get(STAFF, headers=platform)).json()["audit"]
    assert [(e["version"], e["enabled"], e["actor"]) for e in audit] == [
        (2, True, actor["subject"]),
        (1, False, actor["subject"]),
    ]


@pytest.mark.parametrize(
    ("platform_password", "expected"), [(None, 401), ("operator", 401), ("platform", 200)]
)
async def test_platform_requires_a_separate_configured_password(
    session_factory: async_sessionmaker[AsyncSession], platform_password: str | None, expected: int
) -> None:
    cfg = Settings(database_url="sqlite+aiosqlite:///:memory:")
    redis = fakeredis.FakeAsyncRedis()
    res = Resources.build(cfg, session_factory=session_factory, redis=redis)
    mobile = MobileSettings(
        enabled=True,
        auth_mode="password",
        client_hash=SecretStr(encode("owner")),
        admin_hash=SecretStr(encode("operator")),
        platform_hash=SecretStr(encode(platform_password) if platform_password else ""),
    )
    app = create_mobile_app(mobile, cfg, res, IntegrationSettings())
    try:
        async with (
            app.router.lifespan_context(app),
            AsyncClient(transport=ASGITransport(app), base_url="http://test") as http,
        ):
            response = await http.post(
                "/mobile/v1/auth/login",
                json={"login": "platform_demo", "password": platform_password or "operator"},
            )
            assert response.status_code == expected
            if expected == 200:
                assert response.json()["role"] == "platform_admin"
    finally:
        await redis.aclose()

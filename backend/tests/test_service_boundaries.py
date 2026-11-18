"""Pilot service gates and dependency readiness without live infrastructure."""

from collections.abc import AsyncIterator

import fakeredis
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.resources import Resources
from app.main import create_app

TRANSFER_KEY = "transfer-test-0123456789-ABCDEFGHIJKLM"
SOC_KEY = "soc-test-9876543210-NOPQRSTUVWXYZabcd"


def pilot(**kwargs: object) -> Settings:
    return Settings.model_validate(
        {
            "environment": "pilot",
            "api_key": TRANSFER_KEY,
            "soc_api_key": SOC_KEY,
            "cors_origins": ["https://shield.example.test"],
            **kwargs,
        }
    )


def test_pilot_defaults_to_server_context() -> None:
    assert pilot().allow_demo_overrides is False
    assert Settings().allow_demo_overrides is True


@pytest.mark.parametrize(
    "changes",
    [
        {"api_key": None},
        {"soc_api_key": "short"},
        {"api_key": "x" * 64},
        {"api_key": SOC_KEY},
        {"allow_demo_overrides": True},
        {"cors_origins": ["*"]},
        {"cors_origins": ["http://shield.example.test"]},
        {"cors_origins": []},
    ],
)
def test_pilot_rejects_insecure_configuration(changes: dict[str, object]) -> None:
    with pytest.raises(ValidationError) as exc:
        pilot(**changes)
    assert "input_value" not in str(exc.value)


@pytest.fixture
async def secured_client(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncClient]:
    redis = fakeredis.FakeAsyncRedis()
    settings = pilot()
    resources = Resources.build(settings, session_factory=session_factory, redis=redis)
    app = create_app(settings, resources)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        yield client
    await redis.aclose()


async def test_service_roles_cannot_cross_boundary(secured_client: AsyncClient) -> None:
    for headers in ({}, {"X-BCC-API-Key": TRANSFER_KEY}, {"X-BCC-SOC-Key": TRANSFER_KEY}):
        response = await secured_client.get("/api/v1/soc/feed", headers=headers)
        assert response.status_code == 401
    response = await secured_client.get("/api/v1/soc/feed", headers={"X-BCC-SOC-Key": SOC_KEY})
    assert response.status_code == 200
    response = await secured_client.post(
        "/api/v1/transfers/evaluate", json={}, headers={"X-BCC-API-Key": SOC_KEY}
    )
    assert response.status_code == 401


async def test_ready_checks_dependencies_and_is_soc_only(secured_client: AsyncClient) -> None:
    assert (await secured_client.get("/health")).status_code == 200
    assert (await secured_client.get("/ready")).status_code == 401
    response = await secured_client.get("/ready", headers={"X-BCC-SOC-Key": SOC_KEY})
    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "ok", "redis": "ok", "model": "ok"}
    assert (await secured_client.get("/docs")).status_code == 404


async def test_readiness_without_started_resources_returns_unavailable() -> None:
    app = create_app(Settings(soc_api_key=SecretStr(SOC_KEY)))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/ready", headers={"X-BCC-SOC-Key": SOC_KEY})
        assert response.status_code == 503
        assert response.json()["detail"] == "Service dependencies are not ready"


async def test_pilot_rejects_unlisted_browser_origin(secured_client: AsyncClient) -> None:
    response = await secured_client.options(
        "/api/v1/transfers/evaluate",
        headers={
            "Origin": "https://untrusted.example.test",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers

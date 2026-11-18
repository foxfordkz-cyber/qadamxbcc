"""Exercise the merged app, so router registration cannot bypass core protections."""

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.integrations.config import IntegrationSettings
from app.main import create_app
from tests.integrations.conftest import IntegrationWorld
from tests.test_service_boundaries import SOC_KEY, TRANSFER_KEY, pilot

ROUTES = [
    "/trusted-contacts",
    "/external-checks",
    "/integrations/guardian/soc/cases",
]


@pytest.mark.parametrize("path", ROUTES)
@pytest.mark.parametrize("chunked", [False, True])
async def test_all_integration_routers_reject_oversize_before_dependencies(
    path: str,
    chunked: bool,
) -> None:
    # A custom prefix catches hard-coded /api/v1 guards too. No DB/Redis is started:
    # reaching an unguarded handler/dependency would fail instead of returning 413.
    app = create_app(Settings(api_prefix="/test/v2", max_request_bytes=1024))

    async def chunks() -> AsyncIterator[bytes]:
        yield b" " * 700
        yield b" " * 700

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/test/v2" + path,
            content=chunks() if chunked else b" " * 1400,
            headers={"Content-Type": "application/json"},
        )
    assert response.status_code == 413
    assert response.json() == {"detail": "Request body too large"}


async def test_integrations_share_core_peer_quota_and_health_stays_available() -> None:
    app = create_app(Settings(request_rate_limit_per_minute=1))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # An unknown path consumes the same global API quota without requiring resources.
        assert (await client.get("/api/v1/missing")).status_code == 404
        response = await client.get(
            "/api/v1/integrations/health", headers={"X-Forwarded-For": "other-client"}
        )
        assert response.status_code == 429
        assert int(response.headers["Retry-After"]) > 0
        assert response.headers["Cache-Control"] == "no-store"
        assert (await client.get("/health")).status_code == 200


async def test_disabled_integrations_preserve_core_demo(iw: IntegrationWorld) -> None:
    iw.app.state.integration_settings = IntegrationSettings(enabled=False)
    assert (await iw.transfer(cooling=False))["status"] == "approved"
    assert (await iw.client.get("/api/v1/soc/feed")).status_code == 200
    for path in ("/trusted-contacts", "/integrations/health/details"):
        response = await iw.client.get("/api/v1" + path, headers=iw.auth("soc"))
        assert response.status_code == 503
        assert response.json()["detail"] == "integrations disabled"
    response = await iw.client.post("/api/v1/external-checks", headers=iw.auth(), json={})
    assert response.status_code == 503


async def test_pilot_does_not_accept_demo_capabilities_or_expose_docs(
    iw: IntegrationWorld,
) -> None:
    app = create_app(pilot())
    app.state.resources = iw.app.state.resources
    app.state.integration_settings = iw.cfg  # Even an accidentally enabled demo flag fails closed.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert (await client.get(path)).status_code == 404
        for path in ("/trusted-contacts", "/integrations/health/details"):
            response = await client.get("/api/v1" + path, headers=iw.auth("soc"))
            assert response.status_code == 503
            assert response.json()["detail"] == "demo integrations unavailable in pilot"
        for headers in (iw.auth("soc"), {"X-BCC-API-Key": TRANSFER_KEY}):
            assert (await client.get("/api/v1/soc/feed", headers=headers)).status_code == 401
        assert (await client.get("/ready", headers=iw.auth("soc"))).status_code == 401
        assert (
            await client.get("/api/v1/soc/feed", headers={"X-BCC-SOC-Key": SOC_KEY})
        ).status_code == 200
        response = await client.post(
            "/api/v1/transfers/evaluate", json={}, headers=iw.auth("owner")
        )
        assert response.status_code == 401


async def test_cors_keeps_service_boundary_instead_of_wildcard(iw: IntegrationWorld) -> None:
    response = await iw.client.options(
        "/api/v1/trusted-contacts",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization",
        },
    )
    assert response.status_code == 400  # Demo capability stays in the server-side proxy.
    assert "Authorization" not in response.headers.get("Access-Control-Allow-Headers", "")

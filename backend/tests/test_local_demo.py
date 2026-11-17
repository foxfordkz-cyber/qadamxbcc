import asyncio
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from scripts.run_local_demo import create_demo_app, prepare_database, require_demo_environment
from scripts.seed_bcc import DEMO_PRESETS


def test_local_demo_refuses_pilot_and_external_database(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError, match="SQLite"):
        create_demo_app("postgresql+asyncpg://example/never-connect")
    monkeypatch.setenv("BCC_ENVIRONMENT", "pilot")
    with pytest.raises(RuntimeError, match="local/demo"):
        require_demo_environment()


async def test_local_demo_preserves_transfers_and_presets_across_restart(tmp_path: Path) -> None:
    url = await asyncio.to_thread(prepare_database, tmp_path / "local-demo.db")
    prior_total = 0
    created = 0
    for restart in range(2):
        app = create_demo_app(url)
        async with (
            app.router.lifespan_context(app),
            AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
        ):
            assert (await client.get("/ready")).status_code == 200
            feed = (await client.get("/api/v1/soc/feed")).json()
            total = feed["stats"]["total"]
            if restart:
                assert total == prior_total + created
            prior_total = total
            # Persist a pending hold, then check all presets after restart without
            # intentionally triggering the independent five-attempt burst guard.
            presets = DEMO_PRESETS if restart else (DEMO_PRESETS[1],)
            created = len(presets)
            for preset in presets:
                response = await client.post("/api/v1/transfers/evaluate", json=preset.payload())
                assert response.status_code == 200, response.text
                assert response.json()["status"] == preset.expected.value

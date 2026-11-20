import asyncio
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from app.integrations.capabilities import Principal, issue_token
from app.integrations.config import IntegrationSettings
from scripts.local_soc_demo import require_offline_soc
from scripts.run_local_demo import create_demo_app, prepare_database
from scripts.seed_bcc import SENDER_ID


def test_soc_runner_refuses_live_provider_configuration() -> None:
    key = "synthetic-test-key-for-offline-soc-rehearsal"
    safe = IntegrationSettings(
        _env_file=None, enabled=True, signing_key=SecretStr(key), telegram_mode="fake"
    )
    require_offline_soc(safe)
    for changes in (
        {"enabled": False},
        {"environment": "test"},
        {"telegram_mode": "disabled"},
        {"telegram_token": "unexpected-real-provider-token"},
        {"telegram_allowed_chat_ids": [123]},
        {"gateway_enabled": False},
    ):
        with pytest.raises(RuntimeError, match="fake Telegram"):
            require_offline_soc(
                IntegrationSettings.model_validate({**safe.model_dump(), **changes})
            )


async def test_soc_rehearsal_seeds_linked_cases_and_auditable_fake_worker(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    key = "synthetic-test-key-for-offline-soc-rehearsal"
    for name, value in {
        "BCC_ENVIRONMENT": "demo",
        "BCC_INTEGRATIONS_ENABLED": "true",
        "BCC_INTEGRATIONS_ENVIRONMENT": "local",
        "BCC_INTEGRATIONS_SIGNING_KEY": key,
        "BCC_INTEGRATIONS_TELEGRAM_MODE": "fake",
        "BCC_INTEGRATIONS_TELEGRAM_TOKEN": "",
        "BCC_INTEGRATIONS_TELEGRAM_ALLOWED_CHAT_IDS": "[]",
        "BCC_INTEGRATIONS_GATEWAY_ENABLED": "true",
    }.items():
        monkeypatch.setenv(name, value)
    url = await asyncio.to_thread(prepare_database, tmp_path / "soc-demo.db")
    app = create_demo_app(url, soc_demo=True)
    headers = {
        "Authorization": "Bearer " + issue_token(Principal(role="soc", subject=SENDER_ID), key)
    }
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://localhost") as client,
    ):
        response = await client.get("/api/v1/integrations/guardian/soc/cases", headers=headers)
        assert response.status_code == 200
        cases = response.json()["items"]
        assert len(cases) == 2
        for case in cases:
            evidence = await client.get(
                f"/api/v1/integrations/guardian/soc/cases/{case['id']}/evidence", headers=headers
            )
            assert evidence.status_code == 200
            txid = evidence.json()["transaction_id"]
            assert txid is not None
            summary = await client.get(
                f"/api/v1/integrations/soc/transactions/{txid}/summary", headers=headers
            )
            assert summary.status_code == 200
            saved = summary.json()
            assert saved["advisory_only"] is True
            assert saved["gateway_results"][0]["result"]["source"] == "MOCK"
            if case["category"] == "safe_account":
                assert saved["core_status"] == "cooling_off"
                assert saved["notifications"][0]["state"] == "SUSPICION_REPORTED"
                timeline = await client.get(
                    f"/api/v1/integrations/soc/transactions/{txid}/timeline", headers=headers
                )
                assert timeline.status_code == 200
                assert any("SUSPICION" in event["code"] for event in timeline.json()["events"])
        health = await client.get("/api/v1/integrations/health/details", headers=headers)
        assert health.status_code == 200
        assert health.json()["worker"] == "ok"
        assert health.json()["telegram"] == "fake_enabled"
        assert health.json()["real_provider_probed"] is False
    restarted = create_demo_app(url, soc_demo=True)
    with pytest.raises(RuntimeError, match="fresh isolated database"):
        async with restarted.router.lifespan_context(restarted):
            pass

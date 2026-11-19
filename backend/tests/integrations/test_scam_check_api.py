import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import func, select

from app.integrations.models import GuardianReport, IntegrationAudit
from app.integrations.scam_check import ScamCheckResult
from app.models import Transaction
from tests.integrations.conftest import IntegrationWorld

URL = "/api/v1/integrations/guardian/scam-check"
PAYLOAD = {"text": "Переведите деньги на безопасный счёт", "language": "ru"}
DOCS = Path(__file__).resolve().parents[3] / "docs" / "integrations"


@pytest.mark.parametrize("role", ["owner", "soc"])
async def test_authorized_stateless_contract(iw: IntegrationWorld, role: str) -> None:
    headers = iw.auth("soc" if role == "soc" else "owner")
    response = await iw.client.post(URL, json=PAYLOAD, headers=headers)
    assert response.status_code == 200
    result = ScamCheckResult.model_validate(response.json())
    assert result.status == "signals_detected"
    assert result.advisory_only
    assert not result.privacy.stored
    assert response.headers["Cache-Control"] == "no-store"
    async with iw.factory() as session:
        for model in (Transaction, GuardianReport, IntegrationAudit):
            assert await session.scalar(select(func.count()).select_from(model)) == 0


@pytest.mark.parametrize("kind", ["missing", "invalid", "simulator", "disabled", "pilot"])
async def test_access_gates(iw: IntegrationWorld, kind: str) -> None:
    headers = iw.auth()
    expected = 503 if kind in {"disabled", "pilot"} else 401
    if kind == "missing":
        headers = {}
    elif kind == "invalid":
        headers = {"Authorization": "Bearer SYNTHETIC_TOKEN"}
    elif kind == "simulator":
        headers, expected = iw.auth("simulator"), 403
    elif kind == "disabled":
        iw.app.state.integration_settings = iw.cfg.model_copy(update={"enabled": False})
    elif kind == "pilot":
        iw.app.state.settings = iw.app.state.settings.model_copy(update={"environment": "pilot"})
    response = await iw.client.post(URL, json=PAYLOAD, headers=headers)
    assert response.status_code == expected
    assert response.headers["Cache-Control"] == "no-store"
    assert "SYNTHETIC_TOKEN" not in response.text


@pytest.mark.parametrize(
    "body",
    [
        {"text": "SYNTHETIC_PRIVATE", "language": "unsupported"},
        {"text": "SYNTHETIC_PRIVATE", "transaction_id": "SYNTHETIC_PRIVATE"},
        {"text": {"SYNTHETIC_PRIVATE": 1}},
        {"text": "SYNTHETIC_PRIVATE" * 200},
        {"text": "\u200b"},
        ["SYNTHETIC_PRIVATE"],
        "SYNTHETIC_PRIVATE",
    ],
)
async def test_validation_never_reflects_body(iw: IntegrationWorld, body: object) -> None:
    response = await iw.client.post(URL, json=body, headers=iw.auth())
    assert response.status_code == 422
    assert response.json() == {"detail": "invalid_scam_check_request"}
    assert response.headers["Cache-Control"] == "no-store"


async def test_malformed_json_does_not_expose_input(iw: IntegrationWorld) -> None:
    response = await iw.client.post(
        URL,
        content='{"SYNTHETIC_PRIVATE":',
        headers=iw.auth() | {"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert "SYNTHETIC_PRIVATE" not in response.text


async def test_published_examples_match_real_http_and_logs(
    iw: IntegrationWorld, caplog: pytest.LogCaptureFixture
) -> None:
    examples = json.loads((DOCS / "api_examples.json").read_text(encoding="utf-8"))
    scans = [example for example in examples if example["path"] == URL]
    assert len(scans) == 2
    for example in scans:
        response = await iw.client.post(URL, headers=iw.auth(), json=example["request"])
        assert response.status_code == example["status"]
        assert response.json() == example["response"]
        assert example["request"]["text"] not in caplog.text


async def test_rate_limit_and_redis_outage_fail_closed(
    iw: IntegrationWorld,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    iw.app.state.integration_settings = iw.cfg.model_copy(update={"rate_limit_per_minute": 1})
    assert (await iw.client.post(URL, json=PAYLOAD, headers=iw.auth())).status_code == 200
    second = await iw.client.post(URL, json=PAYLOAD, headers=iw.auth())
    assert second.status_code == 429
    assert second.headers["Retry-After"] == "60"
    monkeypatch.setattr(
        type(iw.redis.pipeline()), "execute", AsyncMock(side_effect=RedisConnectionError("private"))
    )
    failed = await iw.client.post(URL, json=PAYLOAD, headers=iw.auth())
    assert failed.status_code == 503
    assert "private" not in failed.text


async def test_cooling_decision_and_existing_state_are_unchanged(iw: IntegrationWorld) -> None:
    transfer = await iw.transfer()
    response = await iw.client.post(URL, json=PAYLOAD, headers=iw.auth())
    assert response.status_code == 200
    async with iw.factory() as session:
        rows = list(await session.scalars(select(Transaction)))
        assert len(rows) == 1
        assert str(rows[0].id) == transfer["transaction_id"]
        assert rows[0].status == "cooling_off"
    schema = iw.app.openapi()["paths"][URL]["post"]
    assert "ScamCheckResult" in json.dumps(schema)

import uuid

import pytest

from app.integrations.nbk_mock.client import GatewayClient
from app.integrations.nbk_mock.localization import ERROR_TEXT, MARKER_TEXT, STATUS_TEXT
from app.integrations.nbk_mock.schemas import GatewayErrorCode, GatewayStatus
from tests.integrations.conftest import IntegrationWorld
from tests.integrations.test_nbk_gateway import InjectedAdapter


def test_all_gateway_codes_have_both_translations() -> None:
    assert set(STATUS_TEXT) == set(GatewayStatus)
    assert set(ERROR_TEXT) == set(GatewayErrorCode)
    assert set(MARKER_TEXT) == {"SYNTHETIC_REVIEW", "SYNTHETIC_NETWORK_SIGNAL"}
    for pair in [*STATUS_TEXT.values(), *ERROR_TEXT.values(), *MARKER_TEXT.values()]:
        assert len(pair) == 2
        assert pair[0]
        assert pair[1]
        assert pair[0] != pair[1]


@pytest.mark.parametrize(
    "identifier", ["SYN-CLEAR-001", "SYN-REVIEW-001", "SYN-NETWORK-001", "SYN-UNKNOWN"]
)
async def test_gateway_exposes_bilingual_evidence(iw: IntegrationWorld, identifier: str) -> None:
    response = await iw.client.post(
        "/api/v1/external-checks",
        headers={**iw.auth(), "Idempotency-Key": str(uuid.uuid4())},
        json={"identifier": identifier},
    )
    assert response.status_code == 200
    data = response.json()
    for language in ("ru", "kk"):
        assert "MOCK" in data[f"description_{language}"]
        assert len(data[f"description_{language}"]) > 40
    assert data["description_ru"] != data["description_kk"]
    if identifier == "SYN-NETWORK-001":
        assert data["result"]["markers"] == ["SYNTHETIC_NETWORK_SIGNAL"]
        assert "сети" in data["description_ru"]
        assert "желі" in data["description_kk"]
    replay = await iw.client.get(f"/api/v1/external-checks/{data['id']}", headers=iw.auth())
    assert replay.json()["description_kk"] == data["description_kk"]


@pytest.mark.parametrize(
    "mode", ["timeout", "unavailable", "internal", "malformed", "expired", "unverified"]
)
async def test_gateway_errors_have_safe_bilingual_descriptions(
    iw: IntegrationWorld, mode: str
) -> None:
    iw.app.state.gateway_client = GatewayClient(InjectedAdapter(mode), timeout=0.01)
    response = await iw.client.post(
        "/api/v1/external-checks",
        headers={**iw.auth(), "Idempotency-Key": str(uuid.uuid4())},
        json={"identifier": "SYN-CLEAR-001"},
    )
    data = response.json()
    assert "операции" in data["description_ru"]
    assert "операция" in data["description_kk"]
    assert "secret-provider" not in response.text
    assert data["result"]["status"] in {"UNKNOWN", "UNAVAILABLE"}

import asyncio
import uuid
from datetime import timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import func, select

from app.db.base import utcnow
from app.integrations.models import IntegrationAudit
from app.integrations.nbk_mock.adapter import MockGatewayAdapter
from app.integrations.nbk_mock.client import GatewayClient
from app.integrations.nbk_mock.errors import GatewayUnavailableError
from app.integrations.nbk_mock.models import ExternalCheck
from app.integrations.nbk_mock.service import GatewayService
from app.models import Transaction, TransactionStatus
from tests.integrations.conftest import IntegrationWorld

ROOT = "/api/v1/external-checks"


class InjectedAdapter:
    def __init__(self, mode: str) -> None:
        self.mode = mode
        self.calls = 0

    async def lookup(self, identifier: str) -> object:
        self.calls += 1
        if self.mode == "timeout":
            await asyncio.sleep(10)
        if self.mode == "unavailable" or (self.mode == "transient" and self.calls == 1):
            raise GatewayUnavailableError("never expose provider internals")
        if self.mode == "internal":
            raise RuntimeError("secret-provider-diagnostic")
        raw = await MockGatewayAdapter().lookup(identifier)
        assert isinstance(raw, dict)
        if self.mode == "malformed":
            raw["surprise"] = "unexpected"
        elif self.mode == "unverified":
            raw["verified"] = False
        elif self.mode == "wrong_identifier":
            raw["identifier"] = "SYN-OTHER"
        elif self.mode == "expired":
            raw["checked_at"] = (utcnow() - timedelta(seconds=120)).isoformat()
            raw["expires_at"] = (utcnow() - timedelta(seconds=60)).isoformat()
        elif self.mode == "future":
            raw["checked_at"] = (utcnow() + timedelta(seconds=30)).isoformat()
        elif self.mode == "bad_source":
            raw["source"] = "OFFICIAL"
        elif self.mode == "unavailable_reply":
            raw["status"] = "UNAVAILABLE"
            raw["error_code"] = "GATEWAY_UNAVAILABLE"
        return raw


async def check(
    iw: IntegrationWorld,
    identifier: str = "SYN-CLEAR-001",
    key: uuid.UUID | None = None,
    transaction_id: object = None,
) -> dict[str, Any]:
    response = await iw.client.post(
        ROOT,
        headers={**iw.auth(), "Idempotency-Key": str(key or uuid.uuid4())},
        json={"identifier": identifier, "transaction_id": transaction_id},
    )
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


@pytest.mark.parametrize(
    ("identifier", "status"),
    [
        ("SYN-CLEAR-001", "CLEAR"),
        ("SYN-REVIEW-001", "INDICATORS"),
        ("SYN-MISSING", "UNKNOWN"),
    ],
)
async def test_typed_synthetic_results(iw: IntegrationWorld, identifier: str, status: str) -> None:
    data = await check(iw, identifier)
    assert data["result"]["status"] == status
    assert data["result"]["source"] == "MOCK"
    assert data["result"]["advisory_only"] is True
    assert bool(data["result"]["markers"]) == (status == "INDICATORS")


@pytest.mark.parametrize(
    "identifier", ["123456789012", "KZ00000000000000000000", "+77000000000", "SYN-", "syn-test"]
)
async def test_non_synthetic_identifiers_rejected(iw: IntegrationWorld, identifier: str) -> None:
    response = await iw.client.post(
        ROOT,
        headers={**iw.auth(), "Idempotency-Key": str(uuid.uuid4())},
        json={"identifier": identifier},
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    ("mode", "code", "status", "calls"),
    [
        ("timeout", "TIMEOUT", "UNAVAILABLE", 2),
        ("unavailable", "GATEWAY_UNAVAILABLE", "UNAVAILABLE", 2),
        ("internal", "INTERNAL_SERVICE_ERROR", "UNKNOWN", 1),
        ("malformed", "MALFORMED_RESPONSE", "UNKNOWN", 1),
        ("unverified", "UNVERIFIED_RESPONSE", "UNKNOWN", 1),
        ("wrong_identifier", "UNVERIFIED_RESPONSE", "UNKNOWN", 1),
        ("expired", "EXPIRED_RESULT", "UNKNOWN", 1),
        ("future", "UNVERIFIED_RESPONSE", "UNKNOWN", 1),
        ("bad_source", "MALFORMED_RESPONSE", "UNKNOWN", 1),
    ],
)
async def test_failure_classification(
    iw: IntegrationWorld, mode: str, code: str, status: str, calls: int
) -> None:
    adapter = InjectedAdapter(mode)
    iw.app.state.gateway_client = GatewayClient(adapter, timeout=0.01)
    async with asyncio.timeout(2):
        data = await check(iw)
    assert data["result"]["error_code"] == code
    assert data["result"]["status"] == status
    assert data["result"]["verified"] is False
    assert adapter.calls == calls
    assert "secret-provider" not in str(data)


async def test_bounded_transient_retry() -> None:
    adapter = InjectedAdapter("transient")
    result = await GatewayClient(adapter).check("SYN-CLEAR-001")
    assert result.status == "CLEAR"
    assert adapter.calls == 2


async def test_idempotency_and_payload_binding(iw: IntegrationWorld) -> None:
    key = uuid.uuid4()
    first = await check(iw, key=key)
    assert await check(iw, key=key) == first
    conflict = await iw.client.post(
        ROOT,
        headers={**iw.auth(), "Idempotency-Key": str(key)},
        json={"identifier": "SYN-REVIEW-001"},
    )
    assert conflict.status_code == 409
    async with iw.factory() as session:
        assert await session.scalar(select(func.count()).select_from(ExternalCheck)) == 1
        assert (
            await session.scalar(
                select(func.count())
                .select_from(IntegrationAudit)
                .where(IntegrationAudit.resource_id == uuid.UUID(first["id"]))
            )
            == 2
        )


async def test_cache_and_expired_cache(iw: IntegrationWorld) -> None:
    first = await check(iw)
    second = await check(iw)
    assert first["cache_hit"] is False
    assert second["cache_hit"] is True
    expired = await InjectedAdapter("expired").lookup("SYN-CLEAR-001")
    import json

    await iw.redis.set(GatewayService.cache_key("SYN-CLEAR-001"), json.dumps(expired), ex=60)
    third = await check(iw)
    assert third["cache_hit"] is False
    assert third["fresh"] is True


async def test_idempotent_replay_does_not_freshen_expired_result(iw: IntegrationWorld) -> None:
    key = uuid.uuid4()
    first = await check(iw, key=key)
    async with iw.factory() as session:
        row = await session.get(ExternalCheck, uuid.UUID(first["id"]))
        assert row
        raw = await InjectedAdapter("expired").lookup("SYN-CLEAR-001")
        assert isinstance(raw, dict)
        row.result = raw
        await session.commit()
    repeated = await check(iw, key=key)
    assert repeated["id"] == first["id"]
    assert repeated["fresh"] is False
    assert repeated["result"]["status"] == "UNKNOWN"
    assert repeated["result"]["error_code"] == "EXPIRED_RESULT"


async def test_owner_and_soc_visibility(iw: IntegrationWorld) -> None:
    data = await check(iw)
    for auth, expected in (
        (iw.auth(), 200),
        (iw.auth("soc"), 200),
        (iw.auth(subject=iw.recipient.id), 404),
        (iw.auth("simulator"), 404),
    ):
        response = await iw.client.get(f"{ROOT}/{data['id']}", headers=auth)
        assert response.status_code == expected


async def test_enrichment_never_changes_transfer(iw: IntegrationWorld) -> None:
    tx = await iw.transfer()
    await check(iw, "SYN-REVIEW-001", transaction_id=tx["transaction_id"])
    async with iw.factory() as session:
        stored = await session.get(Transaction, uuid.UUID(str(tx["transaction_id"])))
        assert stored
        assert stored.status == TransactionStatus.COOLING_OFF
        assert stored.risk_score == tx["risk_score"]


async def test_foreign_transaction_rejected(iw: IntegrationWorld) -> None:
    tx = await iw.transfer()
    response = await iw.client.post(
        ROOT,
        headers={**iw.auth(subject=iw.recipient.id), "Idempotency-Key": str(uuid.uuid4())},
        json={"identifier": "SYN-CLEAR-001", "transaction_id": tx["transaction_id"]},
    )
    assert response.status_code == 404


async def test_disabled_gateway(iw: IntegrationWorld) -> None:
    iw.cfg.gateway_enabled = False
    response = await iw.client.post(
        ROOT,
        headers={**iw.auth(), "Idempotency-Key": str(uuid.uuid4())},
        json={"identifier": "SYN-CLEAR-001"},
    )
    assert response.status_code == 503
    assert (await iw.transfer(cooling=False))["status"] == "approved"


async def test_cache_failure_degrades_safely(
    iw: IntegrationWorld, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(iw.redis, "get", AsyncMock(side_effect=RedisConnectionError("private")))
    monkeypatch.setattr(iw.redis, "set", AsyncMock(side_effect=RedisConnectionError("private")))
    data = await check(iw)
    assert data["result"]["status"] == "CLEAR"
    assert data["cache_hit"] is False


async def test_corrupt_cache_is_not_trusted(iw: IntegrationWorld) -> None:
    await iw.redis.set(GatewayService.cache_key("SYN-CLEAR-001"), "not-json", ex=60)
    data = await check(iw)
    assert data["result"]["status"] == "CLEAR"
    assert data["cache_hit"] is False


async def test_unavailable_results_are_not_cached(iw: IntegrationWorld) -> None:
    adapter = InjectedAdapter("unavailable")
    iw.app.state.gateway_client = GatewayClient(adapter)
    await check(iw)
    assert (await check(iw))["cache_hit"] is False
    assert adapter.calls == 4


async def test_explicit_unavailable_reply_is_not_cached(iw: IntegrationWorld) -> None:
    adapter = InjectedAdapter("unavailable_reply")
    iw.app.state.gateway_client = GatewayClient(adapter)
    await check(iw)
    assert (await check(iw))["cache_hit"] is False
    assert adapter.calls == 2


async def test_incomplete_reservation_is_explicit(iw: IntegrationWorld) -> None:
    data = await check(iw)
    async with iw.factory() as session:
        row = await session.get(ExternalCheck, uuid.UUID(data["id"]))
        assert row
        row.result = None
        await session.commit()
    response = await iw.client.get(f"{ROOT}/{data['id']}", headers=iw.auth())
    assert response.status_code == 409
    async with iw.factory() as session:
        row = await session.get(ExternalCheck, uuid.UUID(data["id"]))
        assert row
        row.created_at = utcnow() - timedelta(seconds=31)
        await session.commit()
    response = await iw.client.get(f"{ROOT}/{data['id']}", headers=iw.auth())
    assert response.json()["result"]["error_code"] == "INCOMPLETE_CHECK"
    assert response.json()["fresh"] is False

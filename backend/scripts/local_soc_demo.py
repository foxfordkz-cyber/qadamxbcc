"""Offline SOC rehearsal helpers for the single-process SQLite/fakeredis runner."""

import asyncio
import logging
import time
import uuid
from typing import Any

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.resources import Resources
from app.integrations.capabilities import Principal, Role, issue_token
from app.integrations.cases.service import expire_cases
from app.integrations.config import IntegrationSettings
from app.integrations.guardian_reports import expire_reports
from app.integrations.nbk_mock.adapter import MockGatewayAdapter
from app.integrations.nbk_mock.client import GatewayClient
from app.integrations.observability import HEARTBEAT
from app.integrations.orchestrator import process_one
from app.integrations.telegram.fake_adapter import FakeTelegramAdapter
from app.integrations.telegram.worker import deliver_one
from scripts.seed_bcc import DEMO_PRESETS, SENDER_ID


def require_offline_soc(config: IntegrationSettings) -> None:
    if (
        not config.enabled
        or config.environment != "local"
        or config.telegram_mode != "fake"
        or config.telegram_token.get_secret_value()
        or config.telegram_allowed_chat_ids
        or not config.gateway_enabled
    ):
        raise RuntimeError("SOC rehearsal requires local fake Telegram and MOCK gateway only")


async def local_soc_worker(resources: Resources, config: IntegrationSettings) -> None:
    """Share the runner's in-process Redis; never construct an external Redis or bot."""
    require_offline_soc(config)
    adapter = FakeTelegramAdapter()
    client = GatewayClient(MockGatewayAdapter(), timeout=config.gateway_timeout_seconds)
    last_cleanup = 0.0
    while True:
        try:
            async with asyncio.timeout(15):
                if time.monotonic() - last_cleanup >= 60:
                    async with resources.session_factory() as session:
                        await expire_reports(session)
                        await expire_cases(session)
                    last_cleanup = time.monotonic()
                await process_one(resources.session_factory, resources.redis, config, client)
                await deliver_one(resources.session_factory, adapter, config)
                await resources.redis.set(HEARTBEAT, "ok", ex=30)
        except Exception:
            # No provider exception, addresses or capability values in logs.
            logging.getLogger(__name__).warning("LOCAL_SOC_WORKER_DEPENDENCY_ERROR")
        await asyncio.sleep(0.5)


async def seed_soc_rehearsal(app: FastAPI, config: IntegrationSettings) -> dict[str, Any]:
    """Prime real existing routes through ASGI; synthetic records and no network IO."""
    require_offline_soc(config)
    key = config.signing_key.get_secret_value()

    def auth(role: Role) -> dict[str, str]:
        return {
            "Authorization": "Bearer " + issue_token(Principal(role=role, subject=SENDER_ID), key),
            "Idempotency-Key": str(uuid.uuid4()),
        }

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://127.0.0.1") as client:

        async def post(path: str, body: dict[str, Any], role: Role = "owner") -> dict[str, Any]:
            response = await client.post(path, json=body, headers=auth(role))
            if response.status_code >= 300:
                raise RuntimeError(f"Local SOC seed request failed: {response.status_code}")
            return response.json()  # type: ignore[no-any-return]

        transfers: dict[str, Any] = {}
        for preset in DEMO_PRESETS:
            payload = preset.payload()
            payload["occurred_at"] = "2026-11-13T09:00:00Z"
            tx = await post("/api/v1/transfers/evaluate", payload)
            if tx["status"] != preset.expected.value:
                raise RuntimeError("Local SOC seed requires a fresh deterministic database")
            transfers[preset.key] = tx

        invite = await post("/api/v1/trusted-contacts", {"owner_consent": True, "language": "kk"})
        contact_id = invite["contact"]["id"]
        await post(
            "/api/v1/trusted-contacts/simulator/update",
            {
                "kind": "start",
                "chat_id": 123,
                "reference": invite["invitation_token"],
            },
            "simulator",
        )
        await post(
            "/api/v1/trusted-contacts/simulator/update",
            {
                "kind": "consent",
                "chat_id": 123,
                "reference": contact_id,
            },
            "simulator",
        )
        scam_id = transfers["scam"]["transaction_id"]
        await post(
            f"/api/v1/integrations/transactions/{scam_id}",
            {
                "contact_id": contact_id,
                "gateway_identifier": "SYN-REVIEW-001",
            },
        )
        hub_id = transfers["hub"]["transaction_id"]
        await post(
            f"/api/v1/integrations/transactions/{hub_id}",
            {
                "gateway_identifier": "SYN-NETWORK-001",
            },
        )
        notification = None
        # Read via owner endpoint, keeping the SOC 30/minute budget free for the UI.
        for _ in range(12):
            response = await client.get(
                f"/api/v1/trusted-contacts/transactions/{scam_id}/notifications",
                headers=auth("owner"),
            )
            response.raise_for_status()
            notifications = response.json()
            if notifications and notifications[0]["state"] == "NOTIFICATION_SENT":
                notification = notifications[0]
                break
            await asyncio.sleep(0.5)
        if notification is None:
            raise RuntimeError("Local SOC worker did not deliver the fake notification")
        await post(
            "/api/v1/trusted-contacts/simulator/update",
            {
                "kind": "suspect",
                "chat_id": 123,
                "reference": notification["id"],
                "message_id": str(uuid.UUID(notification["id"]).int % 2_000_000_000),
            },
            "simulator",
        )

        # The contact delivery can finish before the second (hub) job. Readiness
        # must cover both persisted evidence chains, not merely the first callback.
        for _ in range(12):
            response = await client.get(
                f"/api/v1/integrations/transactions/{hub_id}", headers=auth("owner")
            )
            response.raise_for_status()
            if response.json()["state"] == "COMPLETE":
                break
            await asyncio.sleep(0.5)
        else:
            raise RuntimeError("Local SOC worker did not persist the MOCK hub evidence")

        cases: list[dict[str, str]] = []
        for scenario, category, description in (
            (
                "scam",
                "safe_account",
                "Synthetic caller requested a transfer to a supposedly safe account.",
            ),
            (
                "hub",
                "other",
                "Synthetic transfer recipient has a network pattern requiring demo review.",
            ),
        ):
            transaction_id = transfers[scenario]["transaction_id"]
            # Contact reports cannot claim transaction authority. This explicit owner
            # report links the transaction while preserving the contact suspicion audit.
            report = await post(
                "/api/v1/integrations/guardian/reports",
                {
                    "category": category,
                    "description": description,
                    "transaction_id": transaction_id,
                    "confirmed_demo_submission": True,
                },
            )
            case = await post(
                "/api/v1/integrations/guardian/soc/cases", {"report_id": report["id"]}, "soc"
            )
            cases.append(
                {
                    "scenario": scenario,
                    "transaction_id": transaction_id,
                    "report_id": report["id"],
                    "case_id": case["id"],
                }
            )
        return {
            "cases": cases,
            "delivery": "fake",
            "gateway": "MOCK",
            "live_provider_contacted": False,
        }

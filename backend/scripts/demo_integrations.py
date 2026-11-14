"""Localhost-only fake end-to-end demo; uses the existing deterministic seed accounts."""

import argparse
import asyncio
import json
import uuid
from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse

import httpx

from app.integrations.config import get_integration_settings
from app.integrations.security import Principal, Role, issue_token
from scripts.seed_bcc import DEMO_PRESETS, SENDER_ID

OWNER = SENDER_ID


async def non_contact_demo(
    client: httpx.AsyncClient, auth: Callable[[Role], dict[str, str]], scenario: str
) -> None:
    """Use the core-owned presets and verify that enrichment cannot change a decision."""
    preset = next(preset for preset in DEMO_PRESETS if preset.key == scenario)
    payload = preset.payload()
    payload["occurred_at"] = "2026-11-13T09:00:00Z"
    response = await client.post("/api/v1/transfers/evaluate", json=payload)
    response.raise_for_status()
    tx = response.json()
    assert tx["status"] == preset.expected, "use a fresh seeded demo environment"
    path = f"/api/v1/integrations/soc/transactions/{tx['transaction_id']}"
    if scenario == "hub":
        assert tx["reasons_ru"]
        assert tx["reasons_kk"]
        assert tx["recipient_graph"]["suspected_mule"]
        response = await client.post(
            f"/api/v1/integrations/transactions/{tx['transaction_id']}",
            headers={**auth("owner"), "Idempotency-Key": str(uuid.uuid4())},
            json={"gateway_identifier": "SYN-NETWORK-001"},
        )
        response.raise_for_status()
    for _ in range(20):
        response = await client.get(path, headers=auth("soc"))
        response.raise_for_status()
        data = response.json()
        if scenario == "normal" or data["external_checks"]:
            break
        await asyncio.sleep(2.1)  # respect the default 30/minute SOC capability limit
    else:
        raise RuntimeError("worker did not enrich the synthetic network scenario")
    assert data["core_status"] == preset.expected
    assert not data["notifications"]
    if scenario == "normal":
        assert data["run"] is None
        assert not data["external_checks"]
    else:
        check = data["external_checks"][0]
        assert check["result"]["source"] == "MOCK"
        assert check["result"]["markers"] == ["SYNTHETIC_NETWORK_SIGNAL"]
        assert check["description_ru"]
        assert check["description_kk"]
    print(
        json.dumps(
            {
                "result": "PASS",
                "scenario": scenario,
                "transaction_id": tx["transaction_id"],
                "core_status": data["core_status"],
                "notifications": 0,
                "gateway_source": "MOCK" if scenario == "hub" else None,
            }
        )
    )


async def demo(base_url: str) -> None:
    cfg = get_integration_settings()
    if urlparse(base_url).hostname not in {"localhost", "127.0.0.1"}:
        raise ValueError("demo must target localhost")
    if not cfg.enabled or cfg.telegram_mode != "fake":
        raise ValueError("demo requires enabled fake integrations")

    def auth(role: Role) -> dict[str, str]:
        token = issue_token(Principal(role=role, subject=OWNER), cfg.signing_key.get_secret_value())
        return {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(base_url=base_url, timeout=15) as client:
        await non_contact_demo(client, auth, "normal")

        async def post(path: str, body: dict[str, Any], role: Role = "owner") -> dict[str, Any]:
            response = await client.post(
                path, json=body, headers={**auth(role), "Idempotency-Key": str(uuid.uuid4())}
            )
            response.raise_for_status()
            result: dict[str, Any] = response.json()
            return result

        invite = await post("/api/v1/trusted-contacts", {"owner_consent": True, "language": "kk"})
        contact = invite["contact"]["id"]
        try:
            await post(
                "/api/v1/trusted-contacts/simulator/update",
                {"kind": "start", "chat_id": 123, "reference": invite["invitation_token"]},
                "simulator",
            )
            await post(
                "/api/v1/trusted-contacts/simulator/update",
                {"kind": "consent", "chat_id": 123, "reference": contact},
                "simulator",
            )
            payload = next(preset for preset in DEMO_PRESETS if preset.key == "scam").payload()
            payload["occurred_at"] = "2026-11-13T09:00:00Z"
            tx = await post("/api/v1/transfers/evaluate", payload)
            if tx["status"] != "cooling_off":
                raise RuntimeError("demo requires a fresh deterministic seed")
            job = await post(
                f"/api/v1/integrations/transactions/{tx['transaction_id']}",
                {"contact_id": contact, "gateway_identifier": "SYN-REVIEW-001"},
            )
            for _ in range(20):
                response = await client.get(
                    f"/api/v1/integrations/soc/transactions/{tx['transaction_id']}",
                    headers=auth("soc"),
                )
                response.raise_for_status()
                data = response.json()
                if (
                    data["notifications"]
                    and data["notifications"][0]["state"] == "NOTIFICATION_SENT"
                ):
                    notification = data["notifications"][0]
                    break
                await asyncio.sleep(2.1)
            else:
                raise RuntimeError("worker did not deliver fake notification within 42 seconds")
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
            response = await client.get(
                f"/api/v1/integrations/soc/transactions/{tx['transaction_id']}", headers=auth("soc")
            )
            response.raise_for_status()
            data = response.json()
            assert data["core_status"] == "cooling_off"
            assert data["notifications"][0]["state"] == "SUSPICION_REPORTED"
            print(
                json.dumps(
                    {
                        "result": "PASS",
                        "scenario": "scam",
                        "transaction_id": tx["transaction_id"],
                        "correlation_id": job["correlation_id"],
                        "core_status": data["core_status"],
                        "notification": data["notifications"][0]["state"],
                        "gateway_source": data["external_checks"][0]["result"]["source"],
                    }
                )
            )
        finally:
            revoked = await client.delete(
                f"/api/v1/trusted-contacts/{contact}", headers=auth("owner")
            )
            revoked.raise_for_status()
        await non_contact_demo(client, auth, "hub")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    asyncio.run(demo(parser.parse_args().base_url))

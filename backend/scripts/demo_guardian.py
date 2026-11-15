"""Local fake A/B/network demo plus explicit synthetic incident submission to demo SOC."""

import argparse
import asyncio
import json
import uuid

import httpx

from app.integrations.config import get_integration_settings
from app.integrations.security import Principal, issue_token
from scripts.demo_integrations import OWNER, demo


async def guardian_demo(base_url: str) -> None:
    # Existing demo validates localhost + fake mode before any requests.
    await demo(base_url)
    key = get_integration_settings().signing_key.get_secret_value()
    owner = {"Authorization": "Bearer " + issue_token(Principal(role="owner", subject=OWNER), key)}
    soc = {"Authorization": "Bearer " + issue_token(Principal(role="soc", subject=OWNER), key)}
    async with httpx.AsyncClient(base_url=base_url, timeout=15) as client:
        headers = {**owner, "Idempotency-Key": str(uuid.uuid4())}
        payload = {
            "category": "safe_account",
            "description": "Synthetic caller requested a transfer to a supposedly safe account.",
            "confirmed_demo_submission": True,
        }
        response = await client.post(
            "/api/v1/integrations/guardian/reports", headers=headers, json=payload
        )
        response.raise_for_status()
        report = response.json()
        replay = await client.post(
            "/api/v1/integrations/guardian/reports", headers=headers, json=payload
        )
        replay.raise_for_status()
        assert replay.json()["id"] == report["id"]
        path = "/api/v1/integrations/guardian/reports/" + report["id"]
        response = await client.post(path + "/acknowledge", headers=soc)
        response.raise_for_status()
        assert response.json()["state"] == "DEMO_ACKNOWLEDGED"
        response = await client.get(path + "/history", headers=owner)
        response.raise_for_status()
        events = response.json()
        assert {e["event"] for e in events} == {
            "GUARDIAN_REPORT_SUBMITTED",
            "GUARDIAN_REPORT_DEMO_ACKNOWLEDGED",
        }
        print(
            json.dumps(
                {
                    "result": "PASS",
                    "scenario": "guardian_report",
                    "report_id": report["id"],
                    "status": "DEMO_ACKNOWLEDGED",
                    "events": len(events),
                    "delivery": "local_demo_soc",
                    "scam_check_bot_flow": (
                        "covered separately by RU/KK dispatcher tests; no live Telegram"
                    ),
                }
            )
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    asyncio.run(guardian_demo(parser.parse_args().base_url))

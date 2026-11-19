"""Fake localhost case demo plus privacy and read-only operational diagnostics."""

import argparse
import asyncio
import json

import httpx

from app.integrations.config import get_integration_settings
from app.integrations.security import Principal, issue_token
from scripts.demo_cases import case_demo
from scripts.demo_integrations import OWNER


async def operations_demo(base_url: str) -> None:
    await case_demo(base_url)  # Enforces localhost, fake mode and the existing rate window.
    key = get_integration_settings().signing_key.get_secret_value()
    soc = {"Authorization": "Bearer " + issue_token(Principal(role="soc", subject=OWNER), key)}
    owner = {"Authorization": "Bearer " + issue_token(Principal(role="owner", subject=OWNER), key)}
    root = "/api/v1/integrations"
    async with httpx.AsyncClient(base_url=base_url, timeout=20) as client:
        queue = await client.get(root + "/soc/operations/queue", headers=soc)
        queue.raise_for_status()
        assert queue.json()["by_state"].get("SUSPICION_REPORTED") == 1
        jobs = await client.get(root + "/soc/operations/notifications", headers=soc)
        jobs.raise_for_status()
        assert all(not row["manual_resend_supported"] for row in jobs.json()["items"])
        permissions = await client.get(root + "/privacy/permissions", headers=owner)
        permissions.raise_for_status()
        assert permissions.json()["active_contact_limit"] == 3
        assert permissions.json()["recipients_per_notification"] == 1
        assert "telegram_chat_id" not in permissions.text
        for permission in permissions.json()["permissions"]:
            response = await client.get(
                root + "/privacy/contacts/" + permission["contact_id"] + "/history", headers=owner
            )
            response.raise_for_status()
            assert response.json()["events"]
        assert (
            await client.get(root + "/soc/operations/notifications", headers=owner)
        ).status_code == 403
        print(
            json.dumps(
                {
                    "result": "PASS",
                    "scenario": "operations_privacy",
                    "live_telegram": False,
                    "notifications_inspected": len(jobs.json()["items"]),
                    "manual_resend": False,
                }
            )
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    asyncio.run(operations_demo(parser.parse_args().base_url))

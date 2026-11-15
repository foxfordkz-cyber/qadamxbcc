"""Extend the localhost fake Guardian demo with a versioned SOC case lifecycle."""

import argparse
import asyncio
import json
import uuid
from urllib.parse import urlparse

import httpx

from app.integrations.config import get_integration_settings
from app.integrations.security import Principal, issue_token
from scripts.demo_guardian import guardian_demo
from scripts.demo_integrations import OWNER


async def case_demo(base_url: str) -> None:
    cfg = get_integration_settings()
    if urlparse(base_url).hostname not in {"localhost", "127.0.0.1"} or cfg.telegram_mode != "fake":
        raise RuntimeError("only localhost and fake delivery are allowed")
    await guardian_demo(base_url)
    # Existing preset flow consumes the SOC rate budget; honor the same capability window.
    await asyncio.sleep(61)
    key = cfg.signing_key.get_secret_value()
    owner = {"Authorization": "Bearer " + issue_token(Principal(role="owner", subject=OWNER), key)}
    soc = {"Authorization": "Bearer " + issue_token(Principal(role="soc", subject=OWNER), key)}
    root = "/api/v1/integrations/guardian"
    async with httpx.AsyncClient(base_url=base_url, timeout=20) as client:
        reports = await client.get(root + "/reports", headers=owner)
        reports.raise_for_status()
        report_id = reports.json()[0]["id"]
        response = await client.post(
            root + "/soc/cases",
            headers={**soc, "Idempotency-Key": str(uuid.uuid4())},
            json={"report_id": report_id},
        )
        response.raise_for_status()
        case = response.json()
        path = root + "/soc/cases/" + case["id"]
        for body in [
            {"action": "assign", "assignee": "demo_analyst_a"},
            {"action": "transition", "state": "IN_REVIEW", "reason": "review_started"},
            {"action": "note", "body": "The existing synthetic report was reviewed."},
            {"action": "request_information", "question": "caller_request"},
        ]:
            response = await client.post(
                path + "/actions",
                headers={**soc, "Idempotency-Key": str(uuid.uuid4())},
                json={**body, "expected_version": case["version"]},
            )
            response.raise_for_status()
            case = response.json()
        inbox = root + "/reports/" + report_id + "/information-requests"
        response = await client.get(inbox, headers=owner)
        response.raise_for_status()
        request_id = response.json()[0]["id"]
        response = await client.post(
            inbox + "/" + request_id,
            headers={**owner, "Idempotency-Key": str(uuid.uuid4())},
            json={
                "body": "Synthetic caller requested a secret transfer.",
                "confirmed_demo_submission": True,
            },
        )
        response.raise_for_status()
        response = await client.get(path, headers=soc)
        response.raise_for_status()
        case = response.json()
        for state in ("IN_REVIEW", "RESOLVED", "CLOSED", "IN_REVIEW"):
            headers = {**soc, "Idempotency-Key": str(uuid.uuid4())}
            payload = {
                "action": "transition",
                "expected_version": case["version"],
                "state": state,
                "reason": "reopened",
            }
            response = await client.post(path + "/actions", headers=headers, json=payload)
            response.raise_for_status()
            case = response.json()
            replay = await client.post(path + "/actions", headers=headers, json=payload)
            assert replay.json() == case
        response = await client.get(path + "/export", headers=soc)
        response.raise_for_status()
        assert case["id"] not in response.text
        assert report_id not in response.text
        assert len(response.json()["events"]) == case["version"] == 10
        assert (await client.get(path, headers=owner)).status_code == 403
        print(
            json.dumps(
                {
                    "result": "PASS",
                    "scenario": "soc_case_lifecycle",
                    "version": case["version"],
                    "state": case["state"],
                    "information_channel": "owner_demo_api",
                    "live_telegram": False,
                }
            )
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    asyncio.run(case_demo(parser.parse_args().base_url))

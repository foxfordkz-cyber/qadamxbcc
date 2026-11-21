import secrets
from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.base import utcnow
from app.integrations.cases.models import FraudCase
from app.integrations.models import GuardianReport
from app.mobile_gateway.app import Identity, session_key
from app.mobile_gateway.security_inbox import owner_inbox
from tests.test_case_callbacks import BASE, GUARDIAN, act, keyed, opened
from tests.test_mobile_gateway import OTHER, OWNER
from tests.test_mobile_gateway import mobile_world as mobile_world


async def messages(client: AsyncClient, auth: dict[str, str]) -> list[dict[str, str]]:
    reply = await client.get(BASE + "/inbox", headers=auth)
    assert reply.status_code == 200, reply.text
    items: list[dict[str, str]] = reply.json()["items"]
    assert all(set(row) == {"kind", "object_id", "state", "time"} for row in items)
    return items


async def test_owner_sees_only_current_actionable_case_updates(
    mobile_world: tuple[AsyncClient, Any], session_factory: async_sessionmaker[AsyncSession]
) -> None:
    client, redis = mobile_world
    owner, officer, rid, cid, _ = await opened(client)
    foreign = secrets.token_urlsafe(40)
    await redis.set(session_key(foreign), Identity(role="client", subject=OTHER).model_dump_json())
    assert (await client.get(BASE + "/inbox", headers=officer)).status_code == 403

    async def case_states() -> list[str]:
        items = await messages(client, owner)
        return [
            r["state"] for r in items if r["object_id"] == rid and r["state"].startswith("CASE_")
        ]

    assert await case_states() == []
    await act(client, cid, officer, action="transition", state="IN_REVIEW", reason="review_started")
    await act(client, cid, officer, action="request_information", question="secrecy_pressure")
    assert await case_states() == ["CASE_INFORMATION_REQUIRED"]
    await act(client, cid, officer, action="transition", state="ESCALATED", reason="needs_followup")
    assert await case_states() == ["CASE_INFORMATION_REQUIRED"]
    path = GUARDIAN + f"/reports/{rid}/information-requests"
    questions = (await client.get(path, headers=owner)).json()
    response = await client.post(
        path + "/" + questions[0]["id"],
        headers=keyed(owner),
        json={"confirmed_demo_submission": True, "body": "Private owner reply"},
    )
    assert response.is_success, response.text
    assert await case_states() == []
    await act(client, cid, officer, action="transition", state="CLOSED", reason="confirmed_fraud")
    assert await case_states() == ["CASE_REVIEW_CLOSED"]
    async with session_factory() as db:
        disabled = await owner_inbox(db, OWNER, case_updates=False)
    assert all(not r["state"].startswith("CASE_") for r in disabled)
    assert await messages(client, {"Authorization": f"Bearer {foreign}"}) == []
    await act(client, cid, officer, action="transition", state="IN_REVIEW", reason="reopened")
    assert await case_states() == ["CASE_REVIEW_REOPENED"]
    await act(client, cid, officer, action="request_information", question="remote_access")
    assert await case_states() == ["CASE_INFORMATION_REQUIRED", "CASE_REVIEW_REOPENED"]
    await act(
        client, cid, officer, action="transition", state="CLOSED", reason="insufficient_evidence"
    )
    assert await case_states() == ["CASE_REVIEW_CLOSED"]


@pytest.mark.parametrize("change", ["source", "redaction", "report_expired", "case_expired"])
async def test_unavailable_owner_case_has_no_action_message(
    mobile_world: tuple[AsyncClient, Any],
    session_factory: async_sessionmaker[AsyncSession],
    change: str,
) -> None:
    client, _ = mobile_world
    owner, officer, rid, cid, _ = await opened(client)
    await act(client, cid, officer, action="transition", state="CLOSED", reason="duplicate")
    async with session_factory() as db:
        case_row = await db.get(FraudCase, UUID(cid))
        report = await db.get(GuardianReport, UUID(rid))
        assert case_row is not None
        assert report is not None
        if change == "source":
            case_row.source = "trusted_contact"
        elif change == "redaction":
            report.description = None
        elif change == "report_expired":
            report.expires_at = utcnow() - timedelta(seconds=1)
        else:
            case_row.expires_at = utcnow() - timedelta(seconds=1)
        await db.commit()
    assert all(not r["state"].startswith("CASE_") for r in await messages(client, owner))
    assert (await client.get(BASE + f"/reports/{rid}/callback", headers=owner)).status_code == 404


async def test_inbox_cap_and_ties_are_deterministic(
    mobile_world: tuple[AsyncClient, Any], session_factory: async_sessionmaker[AsyncSession]
) -> None:
    client, _ = mobile_world
    owner, officer, rid, cid, _ = await opened(client)
    await act(client, cid, officer, action="transition", state="IN_REVIEW", reason="review_started")
    await act(client, cid, officer, action="request_information", question="remote_access")
    _, _, second_report, second_case, _ = await opened(client)
    await act(client, second_case, officer, action="transition", state="CLOSED", reason="duplicate")
    now = utcnow()
    async with session_factory() as db:
        for i in range(1, 37):
            db.add(
                GuardianReport(
                    id=UUID(int=i),
                    owner_id=OWNER,
                    idempotency_key=uuid4(),
                    content_hash=f"{i:064x}",
                    category="other",
                    description="Sample report",
                    created_at=now,
                    expires_at=now + timedelta(days=1),
                )
            )
        await db.commit()
    first = await messages(client, owner)
    assert [row["object_id"] for row in first] == [str(UUID(int=i)) for i in range(1, 31)]
    assert await messages(client, owner) == first
    overview = (await client.get(BASE + "/inbox?view=actions", headers=owner)).json()["items"]
    assert [(r["state"], r["object_id"]) for r in overview] == [
        ("CASE_INFORMATION_REQUIRED", rid),
        ("CASE_REVIEW_CLOSED", second_report),
    ]
    assert (await client.get(BASE + "/inbox?view=other", headers=owner)).status_code == 422

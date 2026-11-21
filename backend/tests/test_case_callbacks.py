"""Case communication never performs or resolves a payment."""

import secrets
from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.base import utcnow
from app.integrations.cases.models import CaseEvent
from app.mobile_gateway.app import Identity, session_key
from app.mobile_gateway.callbacks import ACCEPTED, ASKED, DECLINED, INVITED
from tests.test_mobile_gateway import ADMIN_CODE, OTHER, login
from tests.test_mobile_gateway import mobile_world as mobile_world

BASE = "/mobile/v1"
GUARDIAN = BASE + "/api/integrations/guardian"


def keyed(headers: dict[str, str]) -> dict[str, str]:
    return {**headers, "Idempotency-Key": str(uuid4())}


async def opened(client: AsyncClient) -> tuple[dict[str, str], dict[str, str], str, str, str]:
    owner, officer = await login(client), await login(client, ADMIN_CODE)
    transfer = await client.post(
        BASE + "/api/transfers/evaluate",
        headers=owner,
        json={
            "request_id": str(uuid4()),
            "recipient_id": str(OTHER),
            "amount": "900000",
            "context": {"active_call": True, "from_deposit": True},
        },
    )
    assert transfer.status_code == 200, transfer.text
    assert transfer.json()["status"] == "cooling_off"
    tx = transfer.json()["transaction_id"]
    report = await client.post(
        GUARDIAN + "/reports",
        headers=keyed(owner),
        json={
            "description": "Synthetic customer requests review of a suspicious transfer",
            "confirmed_demo_submission": True,
            "category": "impersonation",
            "transaction_id": tx,
        },
    )
    assert report.status_code == 201, report.text
    rid = report.json()["id"]
    case = await client.post(
        GUARDIAN + "/soc/cases", headers=keyed(officer), json={"report_id": rid}
    )
    assert case.status_code == 201, case.text
    return owner, officer, rid, case.json()["id"], tx


async def act(client: AsyncClient, cid: str, officer: dict[str, str], **fields: Any) -> int:
    path = GUARDIAN + f"/soc/cases/{cid}"
    current = await client.get(path, headers=officer)
    value = await client.post(
        path + "/actions",
        headers=keyed(officer),
        json={"expected_version": current.json()["version"], **fields},
    )
    assert value.status_code == 200, value.text
    return int(value.json()["version"])


@pytest.mark.parametrize(
    "outcome", ["confirmed_fraud", "legitimate_transfer", "insufficient_evidence"]
)
async def test_owner_reads_current_case_outcome_and_ledger(
    mobile_world: tuple[AsyncClient, Any], outcome: str
) -> None:
    client, _ = mobile_world
    owner, officer, rid, cid, tx = await opened(client)
    path = BASE + f"/reports/{rid}/callback"
    await act(client, cid, officer, action="transition", state="IN_REVIEW", reason="review_started")
    await act(client, cid, officer, action="transition", state="CLOSED", reason=outcome)
    view = (await client.get(path, headers=owner)).json()
    assert view["case_id"] == cid
    resolution = view["resolution"]
    assert resolution["outcome"] == outcome
    assert resolution["closed_at"]
    assert resolution["operation"] == {
        "transaction_id": tx,
        "amount": "900000.00",
        "currency": "KZT",
        "status": "cooling_off",
    }
    account = (await client.get(BASE + "/account", headers=owner)).json()
    assert resolution["balance"] == account["balance"]
    await act(client, cid, officer, action="transition", state="IN_REVIEW", reason="reopened")
    assert "resolution" not in (await client.get(path, headers=owner)).json()
    await act(client, cid, officer, action="transition", state="CLOSED", reason="duplicate")
    assert (await client.get(path, headers=owner)).json()["resolution"]["outcome"] is None


@pytest.mark.parametrize(("from_client", "answer"), [(True, "accepted"), (False, "declined")])
async def test_case_callback_lifecycle(
    mobile_world: tuple[AsyncClient, Any],
    from_client: bool,
    answer: str,
) -> None:
    client, redis = mobile_world
    owner, officer, rid, cid, tx = await opened(client)
    client_path, staff_path = BASE + f"/reports/{rid}/callback", BASE + f"/cases/{cid}/callback"
    assert (await client.get(client_path, headers=owner)).json() == {
        "case_id": cid,
        "case_state": "NEW",
        "callback": None,
    }
    wrong_subject = secrets.token_urlsafe(40)
    await redis.set(
        session_key(wrong_subject), Identity(role="client", subject=OTHER).model_dump_json()
    )
    other = {"Authorization": f"Bearer {wrong_subject}"}
    assert (await client.get(client_path, headers=other)).status_code == 404
    assert (await client.post(client_path, headers=keyed(other), json={})).status_code == 404
    assert (await client.get(staff_path, headers=owner)).status_code == 403
    assert (await client.get(BASE + "/callbacks", headers=officer)).status_code == 403
    assert (
        await client.post(staff_path, headers=keyed(officer), json={"expected_version": 1})
    ).status_code == 403
    if from_client:
        headers = keyed(owner)
        request = await client.post(client_path, headers=headers, json={})
        assert request.status_code == 200, request.text
        assert request.json()["status"] == "customer_requested"
        assert (await client.post(client_path, headers=headers, json={})).json() == request.json()
    version = await act(client, cid, officer, action="assign", assignee="demo_analyst_a")
    body, invite_headers = {"expected_version": version}, keyed(officer)
    assert (
        await client.post(staff_path, headers=keyed(officer), json={"expected_version": 1})
    ).status_code == 409
    invite = await client.post(staff_path, headers=invite_headers, json=body)
    assert invite.status_code == 200, invite.text
    assert invite.json()["status"] == "requested"
    assert invite.json()["transaction_id"] == tx
    assert (
        await client.post(staff_path, headers=invite_headers, json=body)
    ).json() == invite.json()
    assert (await client.get(BASE + "/callbacks", headers=other)).json()["items"] == []
    assert (await client.get(BASE + "/callbacks", headers=owner)).json()["items"] == [invite.json()]
    reply = BASE + f"/callbacks/{invite.json()['id']}/answer"
    assert (
        await client.post(reply, headers=keyed(other), json={"answer": answer})
    ).status_code == 404
    headers = keyed(owner)
    result = await client.post(reply, headers=headers, json={"answer": answer})
    assert result.status_code == 200, result.text
    assert result.json()["status"] == answer
    assert result.json()["answered_at"]
    assert (
        await client.post(reply, headers=headers, json={"answer": answer})
    ).json() == result.json()
    opposite = "accepted" if answer == "declined" else "declined"
    assert (await client.post(reply, headers=headers, json={"answer": opposite})).status_code == 409
    assert (
        await client.post(reply, headers=keyed(owner), json={"answer": opposite})
    ).status_code == 409
    assert (await client.get(staff_path, headers=officer)).json()["callback"] == result.json()
    assert (
        await client.post(staff_path, headers=invite_headers, json=body)
    ).json() == invite.json()
    detail = await client.get(BASE + f"/api/transfers/{tx}", headers=owner)
    assert detail.json()["status"] == "cooling_off"
    timeline = await client.get(GUARDIAN + f"/soc/cases/{cid}/history", headers=officer)
    audit = [e for e in timeline.json()["items"] if e["code"].startswith("CALLBACK_")]
    codes = ([ASKED] if from_client else []) + [INVITED, ACCEPTED if from_client else DECLINED]
    assert [e["code"] for e in audit] == codes
    assert all(e["description_kk"] and e["description_ru"] for e in audit)
    if answer == "declined":
        again = await client.post(client_path, headers=keyed(owner), json={})
        assert again.status_code == 200
        assert again.json()["id"] != result.json()["id"]
        assert (
            await client.post(reply, headers=headers, json={"answer": answer})
        ).json() == result.json()


@pytest.mark.parametrize("invalidate", ["time", "reopen", "reassign"])
async def test_callback_expiry(
    mobile_world: tuple[AsyncClient, Any],
    session_factory: async_sessionmaker[AsyncSession],
    invalidate: str,
) -> None:
    client, _ = mobile_world
    owner, officer, rid, cid, _ = await opened(client)
    version = await act(client, cid, officer, action="assign", assignee="demo_analyst_a")
    invite = await client.post(
        BASE + f"/cases/{cid}/callback", headers=keyed(officer), json={"expected_version": version}
    )
    callback = invite.json()["id"]
    if invalidate == "time":
        async with session_factory() as session:
            event = await session.scalar(select(CaseEvent).where(CaseEvent.id == UUID(callback)))
            assert event is not None
            event.created_at = utcnow() - timedelta(minutes=16)
            await session.commit()
    elif invalidate == "reassign":
        await act(client, cid, officer, action="assign", assignee="demo_analyst_b")
        await act(client, cid, officer, action="assign", assignee="demo_analyst_a")
    else:
        await act(client, cid, officer, action="transition", state="CLOSED", reason="duplicate")
        await act(client, cid, officer, action="transition", state="IN_REVIEW", reason="reopened")
    assert (await client.get(BASE + "/callbacks", headers=owner)).json()["items"][0][
        "status"
    ] == "expired"
    reply = await client.post(
        BASE + f"/callbacks/{callback}/answer", headers=keyed(owner), json={"answer": "accepted"}
    )
    assert reply.status_code == 409
    again = await client.post(BASE + f"/reports/{rid}/callback", headers=keyed(owner), json={})
    assert again.status_code == 200, again.text
    assert again.json()["status"] == "customer_requested"
    assert again.json()["id"] != callback
    assert (
        await client.post(
            BASE + f"/callbacks/{callback}/answer",
            headers=keyed(owner),
            json={"answer": "accepted"},
        )
    ).status_code == 409

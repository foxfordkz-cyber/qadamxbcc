import asyncio
import os
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.db.base import utcnow
from app.integrations.guardian_reports import (
    ReportRequest,
    contact_identity,
    create_report,
    expire_reports,
)
from app.integrations.models import GuardianReport, IntegrationAudit
from tests.integrations.conftest import IntegrationWorld

ROOT = "/api/v1/integrations/guardian/reports"
BODY = {
    "category": "impersonation",
    "description": "A caller claimed to represent a bank and demanded urgent action.",
    "confirmed_demo_submission": True,
}


async def test_incident_idempotency_ownership_soc_and_history(iw: IntegrationWorld) -> None:
    headers = {**iw.auth(), "Idempotency-Key": str(uuid.uuid4())}
    first = await iw.client.post(ROOT, headers=headers, json=BODY)
    assert first.status_code == 201
    assert first.json()["source"] == "owner_demo"
    rid = first.json()["id"]
    assert (await iw.client.post(ROOT, headers=headers, json=BODY)).json() == first.json()
    conflict = await iw.client.post(ROOT, headers=headers, json={**BODY, "category": "other"})
    assert conflict.status_code == 409
    duplicate = await iw.client.post(
        ROOT, headers={**iw.auth(), "Idempotency-Key": str(uuid.uuid4())}, json=BODY
    )
    assert duplicate.status_code == 409
    assert (
        await iw.client.get(f"{ROOT}/{rid}", headers=iw.auth(subject=iw.recipient.id))
    ).status_code == 404
    assert (await iw.client.get(ROOT, headers=iw.auth(subject=iw.recipient.id))).json() == []
    assert (await iw.client.post(f"{ROOT}/{rid}/acknowledge", headers=iw.auth())).status_code == 403
    for _ in range(2):
        response = await iw.client.post(f"{ROOT}/{rid}/acknowledge", headers=iw.auth("soc"))
        assert response.json()["state"] == "DEMO_ACKNOWLEDGED"
    history = await iw.client.get(f"{ROOT}/{rid}/history", headers=iw.auth("soc"))
    assert [e["event"] for e in history.json()] == [
        "GUARDIAN_REPORT_SUBMITTED",
        "GUARDIAN_REPORT_DEMO_ACKNOWLEDGED",
    ]
    assert str(BODY["description"]) not in history.text
    assert (await iw.client.get(ROOT, headers=iw.auth("simulator"))).status_code == 403


@pytest.mark.parametrize(
    "description",
    [
        "short",
        "x" * 501,
        "Secret OTP is 123456",
        "See https://example.test",
        "Reach me @somebody",
        "Hidden\ncontrol text",
    ],
)
async def test_incident_rejects_sensitive_or_invalid_input(
    iw: IntegrationWorld, description: str
) -> None:
    response = await iw.client.post(
        ROOT,
        headers={**iw.auth(), "Idempotency-Key": str(uuid.uuid4())},
        json={**BODY, "description": description},
    )
    assert response.status_code == 422
    async with iw.factory() as session:
        assert await session.scalar(select(func.count()).select_from(GuardianReport)) == 0


async def test_incident_expiry_removes_content_and_dedup_hash(iw: IntegrationWorld) -> None:
    key = uuid.uuid4()
    async with iw.factory() as session:
        row = await create_report(session, iw.owner.id, ReportRequest.model_validate(BODY), key)
        rid = row.id
        digest = row.content_hash
        row.expires_at = utcnow() - timedelta(seconds=1)
        await session.commit()
        assert await expire_reports(session) == 1
        await session.refresh(row)
        assert row.description is None
        assert row.content_hash != digest
        assert await expire_reports(session) == 0
    assert (await iw.client.get(f"{ROOT}/{rid}", headers=iw.auth())).status_code == 410
    response = await iw.client.post(
        ROOT, headers={**iw.auth(), "Idempotency-Key": str(key)}, json=BODY
    )
    assert response.status_code == 410
    assert (await iw.client.get(ROOT, headers=iw.auth("soc"))).json() == []
    async with iw.factory() as session:
        loaded = await session.get(GuardianReport, rid)
        assert loaded is not None
        loaded.created_at = utcnow() - timedelta(days=31)
        await session.commit()
        await expire_reports(session)
        assert await session.scalar(select(func.count()).select_from(GuardianReport)) == 0
        assert (
            await session.scalar(
                select(func.count())
                .select_from(IntegrationAudit)
                .where(IntegrationAudit.resource_id == rid)
            )
            == 1
        )


async def test_incident_quota_and_foreign_transaction(iw: IntegrationWorld) -> None:
    tx = await iw.transfer()
    foreign = await iw.client.post(
        ROOT,
        headers={**iw.auth(subject=iw.recipient.id), "Idempotency-Key": str(uuid.uuid4())},
        json={**BODY, "transaction_id": tx["transaction_id"]},
    )
    assert foreign.status_code == 404
    for word in ("first", "second", "third", "fourth", "fifth"):
        response = await iw.client.post(
            ROOT,
            headers={**iw.auth(), "Idempotency-Key": str(uuid.uuid4())},
            json={**BODY, "description": str(BODY["description"]) + " " + word},
        )
        assert response.status_code == 201
    response = await iw.client.post(
        ROOT,
        headers={**iw.auth(), "Idempotency-Key": str(uuid.uuid4())},
        json={**BODY, "description": str(BODY["description"]) + " sixth"},
    )
    assert response.status_code == 429


async def test_recipient_report_requires_live_consent(iw: IntegrationWorld) -> None:
    cid = uuid.UUID(await iw.verified())
    async with iw.factory() as session:
        contact = await contact_identity(session, cid, 123)
        row = await create_report(
            session,
            contact.owner_id,
            ReportRequest.model_validate(BODY),
            uuid.uuid4(),
            contact_id=contact.id,
        )
        assert row.source == "trusted_contact"
        rid = row.id
    assert (await iw.client.get(f"{ROOT}/{rid}", headers=iw.auth())).status_code == 404
    assert (await iw.client.get(ROOT, headers=iw.auth())).json() == []
    assert (await iw.client.get(f"{ROOT}/{rid}", headers=iw.auth("soc"))).status_code == 200
    await iw.client.delete(f"/api/v1/trusted-contacts/{cid}", headers=iw.auth())
    from app.integrations.errors import IntegrationError

    async with iw.factory() as session:
        with pytest.raises(IntegrationError):
            await contact_identity(session, cid, 123)


async def test_summary_is_soc_only_and_fact_based(iw: IntegrationWorld) -> None:
    contact = await iw.verified()
    queued = await iw.queue(contact)
    await iw.deliver()
    notification_id = uuid.UUID(str(queued["id"]))
    mid = str(notification_id.int % 2_000_000_000)
    await iw.client.post(
        "/api/v1/trusted-contacts/simulator/update",
        headers=iw.auth("simulator"),
        json={
            "kind": "suspect",
            "chat_id": 123,
            "reference": str(notification_id),
            "message_id": mid,
        },
    )
    path = f"/api/v1/integrations/soc/transactions/{queued['transaction_id']}/summary"
    assert (await iw.client.get(path, headers=iw.auth())).status_code == 403
    response = await iw.client.get(path, headers=iw.auth("soc"))
    assert response.status_code == 200
    data = response.json()
    assert data["core_status"] == "cooling_off"
    assert data["consents"][0]["consented"] is True
    assert data["manual_review_reasons"] == ["CONTACT_SUSPICION"]
    assert data["manual_review_requested"] is True
    assert data["description_ru"]
    assert data["description_kk"]
    assert "telegram_chat_id" not in response.text
    assert "risk_score" not in data
    assert data["recent_events"][-1]["code"] == "SUSPICION_REPORTED"


@pytest.mark.skipif(not os.getenv("BCC_TEST_DATABASE_URL"), reason="PostgreSQL locks required")
async def test_incident_concurrent_replay_and_quota(iw: IntegrationWorld) -> None:
    headers = {**iw.auth(), "Idempotency-Key": str(uuid.uuid4())}
    replies = await asyncio.gather(
        *(iw.client.post(ROOT, headers=headers, json=BODY) for _ in range(3))
    )
    assert all(r.status_code == 201 for r in replies)
    assert len({r.json()["id"] for r in replies}) == 1
    replies = await asyncio.gather(
        *(
            iw.client.post(
                ROOT,
                headers={**iw.auth(), "Idempotency-Key": str(uuid.uuid4())},
                json={**BODY, "description": str(BODY["description"]) + " " + word},
            )
            for word in ("alpha", "beta", "gamma", "delta", "epsilon", "zeta")
        )
    )
    assert sorted(r.status_code for r in replies) == [201, 201, 201, 201, 429, 429]

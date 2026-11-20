import uuid
from datetime import timedelta

from sqlalchemy import select

from app.db.base import utcnow
from app.integrations.cases.models import FraudCase
from app.integrations.models import ContactNotification, IntegrationAudit
from tests.integrations.conftest import IntegrationWorld
from tests.integrations.test_guardian_cases import CASES, act
from tests.integrations.test_orchestration import enqueue, process

ROOT = "/api/v1/integrations/soc/transactions"


async def test_story_requires_soc_and_unknown_transaction_is_not_an_empty_story(
    iw: IntegrationWorld,
) -> None:
    path = f"{ROOT}/{uuid.uuid4()}/story"
    for role in ("owner", "simulator"):
        assert (await iw.client.get(path, headers=iw.auth(role))).status_code == 403
    assert (await iw.client.get(path)).status_code == 401
    assert (await iw.client.get(path, headers=iw.auth("soc"))).status_code == 404
    await iw.redis.set(
        f"bcc:integrations:rate:soc:{iw.owner.id}", iw.cfg.rate_limit_per_minute, ex=60
    )
    limited = await iw.client.get(path, headers=iw.auth("soc"))
    assert limited.status_code == 429
    assert limited.headers["retry-after"] == "60"


async def test_private_story_is_scoped_minimal_and_respects_case_retention(
    iw: IntegrationWorld,
) -> None:
    tx = (await iw.transfer())["transaction_id"]
    path = f"{ROOT}/{tx}/story"
    soc = iw.auth("soc")
    blank = await iw.client.get(path, headers=soc)
    assert blank.json() == {"transaction_id": tx, "events": [], "truncated": False}
    assert blank.headers["cache-control"] == "no-store"
    await enqueue(iw, tx, await iw.verified())
    await process(iw)
    queued = (await iw.client.get(path, headers=soc)).json()["events"]
    assert [e["code"] for e in queued] == ["NOTIFICATION_QUEUED"]
    await iw.deliver()
    report = await iw.client.post(
        "/api/v1/integrations/guardian/reports",
        headers={**iw.auth(), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "transaction_id": tx,
            "category": "safe_account",
            "description": "Synthetic bank review.",
            "confirmed_demo_submission": True,
        },
    )
    assert report.status_code == 201, report.text
    case = await iw.client.post(
        CASES,
        headers={**soc, "Idempotency-Key": str(uuid.uuid4())},
        json={"report_id": report.json()["id"]},
    )
    assert case.status_code == 201, case.text
    row = await act(
        iw, case.json(), action="transition", state="IN_REVIEW", reason="review_started"
    )
    await act(iw, row, action="note", body="Private synthetic note that must stay in the case.")
    async with iw.factory() as session:
        notification = await session.scalar(select(ContactNotification))
        assert notification is not None
        session.add(
            IntegrationAudit(
                owner_id=iw.recipient.id,
                resource_id=notification.id,
                correlation_id=uuid.uuid4(),
                event="SUSPICION_REPORTED",
            )
        )
        await session.commit()
    items = (await iw.client.get(path, headers=soc)).json()["events"]
    assert [(e["role"], e["code"]) for e in items] == [
        ("guardian", "NOTIFICATION_QUEUED"),
        ("guardian", "NOTIFICATION_SENT"),
        ("customer", "OWNER_REPORT_SUBMITTED"),
        ("soc", "CASE_OPENED"),
        ("soc", "CASE_IN_REVIEW"),
    ]
    assert all(set(e) == {"role", "code", "timestamp"} for e in items)
    assert [e["timestamp"] for e in items] == sorted(e["timestamp"] for e in items)
    async with iw.factory() as session:
        stored_case = await session.get(FraudCase, uuid.UUID(row["id"]))
        assert stored_case is not None
        stored_case.expires_at = utcnow() - timedelta(seconds=1)
        await session.commit()
    items = (await iw.client.get(path, headers=soc)).json()["events"]
    assert {e["role"] for e in items} == {"guardian", "customer"}


async def test_story_bounds_rows_and_keeps_latest_events(iw: IntegrationWorld) -> None:
    tx = (await iw.transfer())["transaction_id"]
    await enqueue(iw, tx, await iw.verified())
    await process(iw)
    start = utcnow()
    async with iw.factory() as session:
        row = await session.scalar(select(ContactNotification))
        assert row is not None
        for i in range(42):
            session.add(
                IntegrationAudit(
                    owner_id=iw.owner.id,
                    resource_id=row.id,
                    correlation_id=row.correlation_id,
                    event="NOTIFICATION_RETRY",
                    created_at=start + timedelta(microseconds=i),
                )
            )
        await session.commit()
    await iw.deliver()
    page = (await iw.client.get(f"{ROOT}/{tx}/story", headers=iw.auth("soc"))).json()
    assert page["truncated"] is True
    assert len(page["events"]) == 40
    assert [e["code"] for e in page["events"]] == ["NOTIFICATION_RETRY"] * 39 + [
        "NOTIFICATION_SENT"
    ]

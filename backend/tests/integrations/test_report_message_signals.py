import uuid
from datetime import timedelta

from app.db.base import utcnow
from app.integrations.cases.models import FraudCase
from app.integrations.models import GuardianReport
from tests.integrations.conftest import IntegrationWorld
from tests.integrations.test_guardian_cases import CASES, opened


async def test_owner_shares_only_consented_code_on_existing_report(iw: IntegrationWorld) -> None:
    case = await opened(iw)
    root = "/api/v1/integrations/guardian"
    rid = case["report_id"]
    path = f"{root}/reports/{rid}/message-signal"
    choices = await iw.client.get(f"{root}/report-signals", headers=iw.auth())
    assert set(choices.json()[0]) == {"id", "created_at"}
    assert choices.json()[0]["id"] == rid
    body = {"category": "safeAccount", "consent": True}
    assert (
        await iw.client.post(path, headers=iw.auth(), json={**body, "consent": False})
    ).status_code == 422
    assert (
        await iw.client.post(path, headers=iw.auth(), json={**body, "text": "private"})
    ).status_code == 422
    assert (
        await iw.client.post(path, headers=iw.auth(subject=iw.recipient.id), json=body)
    ).status_code == 404
    assert (await iw.client.post(path, headers=iw.auth("soc"), json=body)).status_code == 403
    for _ in range(2):
        receipt = await iw.client.post(path, headers=iw.auth(), json=body)
        assert receipt.json() == {"report_id": rid, "category": "safeAccount"}
    evidence_path = f"{CASES}/{case['id']}/evidence"
    evidence = (await iw.client.get(evidence_path, headers=iw.auth("soc"))).json()
    assert evidence["message_signals"] == ["safeAccount"]
    assert sum(e["event"] == "MESSAGE_SIGNAL_SAFE_ACCOUNT" for e in evidence["report_events"]) == 1
    async with iw.factory() as session:
        row = await session.get(FraudCase, uuid.UUID(case["id"]))
        assert row
        row.state = "CLOSED"
        await session.commit()
    assert (await iw.client.get(f"{root}/report-signals", headers=iw.auth())).json() == []
    assert (await iw.client.post(path, headers=iw.auth(), json=body)).status_code == 409
    async with iw.factory() as session:
        report = await session.get(GuardianReport, uuid.UUID(rid))
        assert report
        report.expires_at = utcnow() - timedelta(minutes=1)
        await session.commit()
    assert (await iw.client.post(path, headers=iw.auth(), json=body)).status_code == 410
    assert (await iw.client.get(evidence_path, headers=iw.auth("soc"))).json()[
        "message_signals"
    ] == []

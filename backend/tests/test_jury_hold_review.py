import uuid
from datetime import timedelta
from decimal import Decimal
from html import escape

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db.base import utcnow
from app.integrations.cases.models import FraudCase
from app.integrations.config import IntegrationSettings
from app.integrations.models import ContactNotification
from app.integrations.telegram.fake_adapter import FakeTelegramAdapter
from app.integrations.telegram.service import TrustedContactService
from app.integrations.telegram.worker import deliver_one
from app.mobile_gateway.hold_review import escalate_due
from app.mobile_gateway.jury_results import router
from app.models import Transaction
from app.models.family_approval import FamilyApproval
from scripts.payee_followup_replay import PAIRS, evaluate_arm
from tests.test_mobile_gateway import ADMIN_CODE, OWNER, login
from tests.test_mobile_gateway import mobile_world as mobile_world
from tests.test_second_confirmation import ANSWERS, API, SETTINGS, contact, evaluate


def test_jury_evidence():
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as http:
        page = http.get("/jury/results").text
        for value in (57, 3, 4):
            assert f"<b>{value}</b>" in page
        assert "seller-06" in page
        assert "120" in page
        pair = http.post("/jury/results/pair")
        assert pair.status_code == 200
        assert "Мақұлданды" in pair.text
        assert "Кідіріс" in pair.text
        assert "96 000" in pair.text


async def test_each_jury_pair_is_selectable_and_shows_the_engine_evidence():
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as http:
        menu = http.get("/jury/results").text
        for pair in PAIRS:
            if pair != PAIRS[0]:
                assert f'formaction="/jury/results/pair?scenario={pair.name}"' in menu
            response = http.post("/jury/results/pair", params={"scenario": pair.name})
            assert response.status_code == 200
            sections = response.text.split("<section>")[1:]
            assert len(sections) == 2
            assert ("одинаковые признаки" in response.text) == (pair.honest == pair.fraud)
            for fraud, section in zip((False, True), sections, strict=True):
                arm = pair.fraud if fraud else pair.honest
                result = await evaluate_arm(pair, fraud)
                expected = {"approved": "Одобрено", "cooling_off": "Пауза", "blocked": "Блок"}
                assert f"<h3>{expected[result.decision.value]}" in section
                assert ("<dd>Иә / Да</dd>" in section) == arm.requested
                assert ("Первый перевод</dd>" in section) == (arm.prior == 0)
                for reason in result.reasons:
                    assert escape(reason.reason_ru) in section
                    assert escape(reason.reason_kk) in section
        assert http.post("/jury/results/pair?scenario=unknown").status_code == 404


@pytest.mark.parametrize("trigger", ["appeal", "deadline", "suspicion"])
async def test_review_roundtrip(mobile_world, session_factory, trigger):
    client, _ = mobile_world
    owner, staff = await login(client), await login(client, ADMIN_CODE)

    async def balance():
        return Decimal((await client.get("/mobile/v1/account", headers=owner)).json()["balance"])

    before = await balance()
    if trigger != "appeal":
        async with session_factory() as db:
            member = contact(OWNER, "510008")
            db.add(member)
            await db.commit()
            cid = str(member.id)
        assert (
            await client.post(SETTINGS, headers=owner, json={"action": "enable", "contact_id": cid})
        ).is_success
    amount = "250000"
    if trigger == "appeal":
        # A legitimate buyer happens to be on the phone when paying a new recipient.
        amount = "40000"
        response = await client.post(
            API + "/evaluate",
            headers=owner,
            json={
                "request_id": str(uuid.uuid4()),
                "recipient_phone": "+77010000002",
                "amount": amount,
                "context": {"call_pressure_answer": "on_call"},
            },
        )
        assert response.is_success, response.text
        tx = response.json()
    else:
        tx = await evaluate(client, owner, amount, uuid.uuid4())
    assert tx["status"] == "cooling_off"
    tid = uuid.UUID(tx["transaction_id"])
    path = f"/mobile/v1/protection/{tid}/review"
    assert (await client.post(path, headers=staff)).status_code == 403
    if trigger != "appeal":
        cfg = IntegrationSettings(enabled=True, signing_key="x" * 40)
        adapter = FakeTelegramAdapter()
        assert await deliver_one(session_factory, adapter, cfg)
        await escalate_due(session_factory)
        async with session_factory() as db:
            assert await db.scalar(select(func.count()).select_from(FraudCase)) == 0
        async with session_factory() as db:
            notice = await db.scalar(
                select(ContactNotification).where(ContactNotification.transaction_id == tid)
            )
            if trigger == "suspicion":
                await TrustedContactService(db, cfg).callback(
                    notice.id, 510008, notice.message_id, "suspect"
                )
            else:
                (await db.get(FamilyApproval, tid)).expires_at = utcnow() - timedelta(seconds=1)
                await db.commit()
        await escalate_due(session_factory)
        await escalate_due(session_factory)
        async with session_factory() as db:
            assert await db.scalar(select(func.count()).select_from(FraudCase)) == 1
    r = await client.post(path, headers=owner)
    assert r.status_code == 200, r.text
    rid = r.json()["report_id"]
    assert (await client.post(path, headers=owner)).json() == r.json()
    route = "/mobile/v1/api/integrations/guardian/soc/cases/" + rid
    case = (await client.get(route, headers=staff)).json()
    assert case["report_id"] == rid
    assert (
        case["source"]
        == {"appeal": "owner_demo", "deadline": "guardian_timeout", "suspicion": "guardian_signal"}[
            trigger
        ]
    )
    assert before == await balance()
    if trigger == "deadline":
        assert (await client.get(f"{API}/{tid}", headers=owner)).json()["status"] == "cooling_off"
        return
    if trigger == "appeal":

        async def act(payload):
            response = await client.post(
                route + "/actions",
                headers={**staff, "Idempotency-Key": str(uuid.uuid4())},
                json={"expected_version": case["version"], **payload},
            )
            assert response.is_success, response.text
            return response.json()

        case = await act({"action": "transition", "state": "IN_REVIEW", "reason": "review_started"})
        case = await act({"action": "request_information", "question": "caller_request"})
        chat = "/mobile/v1/api/integrations/guardian/reports/" + rid + "/information-requests"
        question = (await client.get(chat, headers=owner)).json()[0]
        reply = await client.post(
            chat + "/" + question["id"],
            headers={**owner, "Idempotency-Key": str(uuid.uuid4())},
            json={"body": "Я сам выбрал получателя и сумму.", "confirmed_demo_submission": True},
        )
        assert reply.is_success, reply.text
        case = (await client.get(route, headers=staff)).json()
    outcome = "legitimate_transfer" if trigger == "appeal" else "confirmed_fraud"
    decision = await client.post(
        route + "/actions",
        headers={**staff, "Idempotency-Key": str(uuid.uuid4())},
        json={
            "expected_version": case["version"],
            "action": "transition",
            "state": "CLOSED",
            "reason": outcome,
        },
    )
    assert decision.is_success, decision.text
    receipt = (await client.get(f"/mobile/v1/reports/{rid}/callback", headers=owner)).json()
    assert receipt["resolution"]["operation"]["transaction_id"] == str(tid)
    assert receipt["resolution"]["outcome"] == outcome
    assert Decimal(receipt["resolution"]["balance"]) == before
    assert receipt["resolution"]["operation"]["status"] == "cooling_off"
    assert before == await balance()
    if trigger == "appeal":
        async with session_factory() as db:
            (await db.get(Transaction, tid)).cooling_until = utcnow() - timedelta(seconds=2)
            await db.commit()
        for attempt in range(2):
            result = await client.post(
                f"{API}/{tid}/resolve-cooling", headers=owner, json={"answers": ANSWERS}
            )
            allowed_statuses = (200,) if attempt == 0 else (200, 409)
            assert result.status_code in allowed_statuses
            assert await balance() == before - Decimal(amount)

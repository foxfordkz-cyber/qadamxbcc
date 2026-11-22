import asyncio
import os
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import func, select

from app.db.base import utcnow
from app.integrations.cases.models import CaseContent, CaseEvent, FraudCase
from app.integrations.cases.policy_review import compare_policies
from app.integrations.cases.service import expire_cases
from app.integrations.guardian_reports import ReportRequest, create_report
from app.integrations.models import GuardianReport
from app.models import Transaction, TransactionStatus
from tests.integrations.conftest import IntegrationWorld

ROOT = "/api/v1/integrations/guardian"
CASES = ROOT + "/soc/cases"
DESCRIPTION = "Synthetic caller demanded urgent confidential action."


async def opened(
    iw: IntegrationWorld, *, contact: bool = False, transaction_id: uuid.UUID | None = None
) -> dict[str, Any]:
    cid = uuid.UUID(await iw.verified()) if contact else None
    async with iw.factory() as session:
        report = await create_report(
            session,
            iw.owner.id,
            ReportRequest(
                category="impersonation",
                description=DESCRIPTION,
                transaction_id=transaction_id,
                confirmed_demo_submission=True,
            ),
            uuid.uuid4(),
            contact_id=cid,
        )
    response = await iw.client.post(
        CASES,
        headers={
            **iw.auth("soc"),
            "Idempotency-Key": str(uuid.uuid4()),
        },
        json={"report_id": str(report.id)},
    )
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


async def act(iw: IntegrationWorld, row: dict[str, Any], **body: Any) -> dict[str, Any]:
    response = await iw.client.post(
        f"{CASES}/{row['id']}/actions",
        headers={
            **iw.auth("soc"),
            "Idempotency-Key": str(uuid.uuid4()),
        },
        json={"expected_version": row["version"], **body},
    )
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


async def test_case_lifecycle_history_export_analytics(iw: IntegrationWorld) -> None:
    row = await opened(iw)
    row = await act(iw, row, action="assign", assignee="demo_analyst_a")
    row = await act(iw, row, action="categorize", category="remote_access")
    row = await act(iw, row, action="note", body="Synthetic evidence was checked by an analyst.")
    for state in ("IN_REVIEW", "ESCALATED", "RESOLVED", "CLOSED", "IN_REVIEW"):
        row = await act(iw, row, action="transition", state=state, reason="reopened")
    assert row["version"] == 9
    history = (
        await iw.client.get(f"{CASES}/{row['id']}/history?limit=3", headers=iw.auth("soc"))
    ).json()
    assert history["next_after_version"] == 3
    assert all(e["description_ru"] and e["description_kk"] for e in history["items"])
    tail = (
        await iw.client.get(f"{CASES}/{row['id']}/history?after_version=3", headers=iw.auth("soc"))
    ).json()
    assert len(tail["items"]) == 6
    assert tail["next_after_version"] is None
    notes = await iw.client.get(f"{CASES}/{row['id']}/notes", headers=iw.auth("soc"))
    assert len(notes.json()["items"]) == 1
    exported = await iw.client.get(f"{CASES}/{row['id']}/export", headers=iw.auth("soc"))
    assert exported.headers["Cache-Control"] == "no-store"
    for private in (
        row["id"],
        row["report_id"],
        str(iw.owner.id),
        DESCRIPTION,
        "analyst_a",
        "body",
    ):
        assert private not in exported.text
    assert len(exported.json()["events"]) == 9
    metrics = (await iw.client.get(CASES + "/analytics", headers=iw.auth("soc"))).json()
    assert metrics["total"] == metrics["open"] == metrics["manually_reviewed_cases"] == 1
    assert metrics["escalated_cases"] == 1
    assert metrics["manual_review_share"] == 1.0
    assert metrics["oldest_current_status_seconds"]["IN_REVIEW"] >= 0
    evidence = (await iw.client.get(f"{CASES}/{row['id']}/evidence", headers=iw.auth("soc"))).json()
    assert evidence["report_available"]
    assert evidence["recipient_ledger"] is None
    assert len(evidence["report_events"]) == 1


async def test_case_role_boundary_and_safe_validation(iw: IntegrationWorld) -> None:
    row = await opened(iw)
    for role in ("owner", "simulator"):
        headers = iw.auth(role)
        for path in (
            CASES,
            CASES + "/analytics",
            f"{CASES}/{row['id']}",
            f"{CASES}/{row['id']}/notes",
            f"{CASES}/{row['id']}/evidence",
            f"{CASES}/{row['id']}/export",
        ):
            assert (await iw.client.get(path, headers=headers)).status_code == 403
        assert (
            await iw.client.post(
                f"{CASES}/{row['id']}/actions",
                headers={
                    **headers,
                    "Idempotency-Key": str(uuid.uuid4()),
                },
                json={
                    "action": "transition",
                    "state": "IN_REVIEW",
                    "reason": "review_started",
                    "expected_version": 1,
                },
            )
        ).status_code == 403
    assert (await iw.client.get(CASES)).status_code == 401
    invalid = "password SECRET_VALUE_123456"
    response = await iw.client.post(
        f"{CASES}/{row['id']}/actions",
        headers={
            **iw.auth("soc"),
            "Idempotency-Key": str(uuid.uuid4()),
        },
        json={"action": "note", "body": invalid, "expected_version": 1},
    )
    assert response.status_code == 422
    assert invalid not in response.text
    assert response.headers["Cache-Control"] == "no-store"


async def test_case_ledger_uses_settlement_before_original_transfer(iw: IntegrationWorld) -> None:
    payment = await iw.transfer()
    tx_id = uuid.UUID(str(payment["transaction_id"]))
    case = await opened(iw, transaction_id=tx_id)
    path = f"{CASES}/{case['id']}/evidence"
    before = datetime.fromisoformat(str(payment["created_at"]))
    oldest = before - timedelta(hours=24)

    def movement(
        index: int,
        created: datetime,
        settled: datetime | None = None,
        *,
        outgoing: bool = False,
        status: TransactionStatus = TransactionStatus.APPROVED,
        currency: str = "KZT",
    ) -> Transaction:
        return Transaction(
            id=uuid.UUID(int=index),
            device_id="sample",
            sender_id=iw.recipient.id if outgoing else iw.owner.id,
            recipient_id=iw.owner.id if outgoing else iw.recipient.id,
            created_at=created,
            resolved_at=settled,
            amount=Decimal(f"{index}.35"),
            status=status,
            currency=currency,
        )

    response = await iw.client.get(path, headers=iw.auth("soc"))
    assert response.json()["recipient_ledger"]["items"] == []
    async with iw.factory() as session:
        session.add_all(
            [
                movement(1, oldest),
                # Initiated outside the period but credited during it.
                movement(
                    2, oldest - timedelta(hours=1), before - timedelta(minutes=1), outgoing=True
                ),
                movement(3, oldest, before + timedelta(minutes=1)),
                movement(4, before),
                movement(5, oldest, before),
                movement(6, oldest, status=TransactionStatus.COOLING_OFF),
                movement(7, oldest, status=TransactionStatus.BLOCKED),
                movement(8, oldest, status=TransactionStatus.CANCELLED),
                movement(9, oldest, currency="USD"),
                movement(10, oldest - timedelta(seconds=1)),
            ]
        )
        await session.commit()
    response = await iw.client.get(path, headers=iw.auth("soc"))
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json()["case_id"] == case["id"]
    history = response.json()["recipient_ledger"]
    assert datetime.fromisoformat(history["before_time"]) == before
    assert datetime.fromisoformat(history["from_time"]) == oldest
    assert not history["has_more"]
    assert [
        (uuid.UUID(x["transaction_id"]).int, x["direction"], x["amount"]) for x in history["items"]
    ] == [
        (2, "outgoing", "2.35"),
        (1, "incoming", "1.35"),
    ]
    assert datetime.fromisoformat(history["items"][0]["settled_at"]) == before - timedelta(
        minutes=1
    )
    assert set(history["items"][0]) == {"transaction_id", "direction", "amount", "settled_at"}
    async with iw.factory() as session:
        session.add_all(movement(i, oldest) for i in range(20, 29))
        await session.commit()
    capped = (await iw.client.get(path, headers=iw.auth("soc"))).json()["recipient_ledger"]
    assert capped["has_more"]
    assert len(capped["items"]) == 8
    assert uuid.UUID(capped["items"][1]["transaction_id"]).int == 28
    # Expiring a linked report removes access to its ledger even if the case is still open.
    async with iw.factory() as session:
        report = await session.get(GuardianReport, uuid.UUID(case["report_id"]))
        assert report is not None
        report.expires_at = utcnow() - timedelta(seconds=1)
        await session.commit()
    expired = (await iw.client.get(path, headers=iw.auth("soc"))).json()
    assert not expired["report_available"]
    assert expired["transaction_id"] is None
    assert expired["recipient_ledger"] is None


async def test_shadow_review_uses_initial_decision_and_retracts_reopened_label(
    iw: IntegrationWorld,
) -> None:
    payment = await iw.transfer(cooling=False)
    tx_id = uuid.UUID(str(payment["transaction_id"]))
    case = await opened(iw)
    async with iw.factory() as session:
        report = await session.get(GuardianReport, uuid.UUID(case["report_id"]))
        txn = await session.get(Transaction, tx_id)
        assert report is not None
        assert txn is not None
        report.transaction_id = tx_id
        txn.evaluation_snapshot = {
            **txn.evaluation_snapshot,
            "status": "approved",
            "risk_score": 37,
        }
        await session.commit()
    invalid = await iw.client.post(
        f"{CASES}/{case['id']}/actions",
        headers={**iw.auth("soc"), "Idempotency-Key": str(uuid.uuid4())},
        json={
            "expected_version": case["version"],
            "action": "transition",
            "state": "IN_REVIEW",
            "reason": "confirmed_fraud",
        },
    )
    assert invalid.status_code == 409
    case = await act(iw, case, action="transition", state="CLOSED", reason="confirmed_fraud")
    url = CASES + "/analytics"
    comparison = (await iw.client.get(url, headers=iw.auth("soc"))).json()["policy_comparison"]
    assert (
        comparison["extra_holds"]
        == comparison["candidate_detected"]
        == comparison["fraud_labelled"]
        == 1
    )
    assert comparison["baseline_detected"] == 0
    assert comparison["label_coverage"] == 1
    policies = {r["threshold"]: r for r in comparison["policies"]}
    assert list(policies) == [None, 25, 30, 35, 40]
    for threshold, row in policies.items():
        assert row["missed_fraud"] == int(threshold is None or threshold > 37)
        assert row["false_per_1000_legitimate"] is None
    case = await act(iw, case, action="transition", state="IN_REVIEW", reason="reopened")
    comparison = (await iw.client.get(url, headers=iw.auth("soc"))).json()["policy_comparison"]
    assert comparison["fraud_labelled"] == 0
    assert comparison["label_coverage"] == 0
    assert all(row["missed_fraud"] is None for row in comparison["policies"])
    await act(iw, case, action="transition", state="CLOSED", reason="legitimate_transfer")
    comparison = (await iw.client.get(url, headers=iw.auth("soc"))).json()["policy_comparison"]
    assert comparison["candidate_false_interventions"] == comparison["legitimate_labelled"] == 1
    assert comparison["baseline_false_interventions"] == comparison["fraud_labelled"] == 0
    policies = {r["threshold"]: r for r in comparison["policies"]}
    assert policies[35]["false_per_1000_legitimate"] == 1000
    assert policies[40]["false_per_1000_legitimate"] == 0
    async with iw.factory() as session:
        txn = await session.get(Transaction, tx_id)
        assert txn is not None
        assert txn.status.value == payment["status"]
        # All shadow policies share the same date filter and the same frozen observations.
        now = utcnow()
        txn.created_at = now - timedelta(days=10)
        await session.commit()
        recent = await compare_policies(session, now, start=now - timedelta(days=7))
        month = await compare_policies(session, now, start=now - timedelta(days=30))
        assert recent.first_sample_at is None
        assert recent.label_coverage is None
        assert all(row.false_per_1000_legitimate is None for row in recent.policies)
        assert month.first_sample_at == month.last_sample_at == txn.created_at
        assert month.legitimate_labelled == month.evaluated == 1


async def test_case_idempotency_version_and_actor_scope(iw: IntegrationWorld) -> None:
    row = await opened(iw)
    headers = {**iw.auth("soc"), "Idempotency-Key": str(uuid.uuid4())}
    body = {
        "action": "note",
        "body": "A synthetic observation is retained briefly.",
        "expected_version": 1,
    }
    path = f"{CASES}/{row['id']}/actions"
    first = await iw.client.post(path, headers=headers, json=body)
    assert first.status_code == 200
    assert (await iw.client.post(path, headers=headers, json=body)).json() == first.json()
    assert (
        await iw.client.post(
            path, headers=headers, json={**body, "body": "Different synthetic note."}
        )
    ).status_code == 409
    assert (
        await iw.client.post(
            path, headers={**headers, **iw.auth("soc", iw.recipient.id)}, json=body
        )
    ).status_code == 409
    stale = await iw.client.post(
        path, headers={**headers, "Idempotency-Key": str(uuid.uuid4())}, json=body
    )
    assert stale.status_code == 409
    assert "case_version_conflict" in stale.text
    async with iw.factory() as session:
        assert await session.scalar(select(func.count()).select_from(CaseEvent)) == 2
        assert await session.scalar(select(func.count()).select_from(CaseContent)) == 1


async def test_case_open_replay_and_nonexistent_source(iw: IntegrationWorld) -> None:
    row = await opened(iw)
    async with iw.factory() as session:
        event = await session.scalar(select(CaseEvent).where(CaseEvent.version == 1))
        assert event
        key = event.key
    replay = await iw.client.post(
        CASES,
        headers={
            **iw.auth("soc"),
            "Idempotency-Key": str(key),
        },
        json={"report_id": row["report_id"]},
    )
    assert replay.json() == row
    for rid, expected in ((row["report_id"], 409), (str(uuid.uuid4()), 404)):
        response = await iw.client.post(
            CASES,
            headers={
                **iw.auth("soc"),
                "Idempotency-Key": str(uuid.uuid4()),
            },
            json={"report_id": rid},
        )
        assert response.status_code == expected


STATES = ("NEW", "IN_REVIEW", "NEEDS_INFORMATION", "ESCALATED", "RESOLVED", "CLOSED")
ALLOWED = {
    "NEW": {"IN_REVIEW", "ESCALATED", "CLOSED"},
    "IN_REVIEW": {"ESCALATED", "RESOLVED", "CLOSED"},
    "NEEDS_INFORMATION": {"IN_REVIEW", "ESCALATED", "CLOSED"},
    "ESCALATED": {"IN_REVIEW", "RESOLVED", "CLOSED"},
    "RESOLVED": {"IN_REVIEW", "CLOSED"},
    "CLOSED": {"IN_REVIEW"},
}


@pytest.mark.parametrize("origin", STATES)
async def test_case_state_matrix(iw: IntegrationWorld, origin: str) -> None:
    row = await opened(iw)
    for target in STATES:
        async with iw.factory() as session:
            stored = await session.get(FraudCase, uuid.UUID(row["id"]))
            assert stored
            stored.state = origin
            await session.commit()
            version = stored.version
        response = await iw.client.post(
            f"{CASES}/{row['id']}/actions",
            headers={
                **iw.auth("soc"),
                "Idempotency-Key": str(uuid.uuid4()),
            },
            json={
                "expected_version": version,
                "action": "transition",
                "state": target,
                "reason": "reopened",
            },
        )
        assert response.status_code == (200 if target in ALLOWED[origin] else 409), response.text


async def test_case_allowed_information_channel_and_owner_isolation(iw: IntegrationWorld) -> None:
    row = await opened(iw)
    row = await act(iw, row, action="transition", state="IN_REVIEW", reason="review_started")
    row = await act(iw, row, action="request_information", question="caller_request")
    path = f"{ROOT}/reports/{row['report_id']}/information-requests"
    assert (await iw.client.get(path, headers=iw.auth(subject=iw.recipient.id))).status_code == 404
    questions = (await iw.client.get(path, headers=iw.auth())).json()
    assert len(questions) == 1
    assert not questions[0]["answered"]
    request_id = questions[0]["id"]
    headers = {**iw.auth(), "Idempotency-Key": str(uuid.uuid4())}
    body = {
        "body": "The caller asked to install remote access software.",
        "confirmed_demo_submission": True,
    }
    response = await iw.client.post(path + "/" + request_id, headers=headers, json=body)
    assert response.status_code == 200
    assert (
        await iw.client.post(path + "/" + request_id, headers=headers, json=body)
    ).json() == response.json()
    assert (
        await iw.client.post(
            path + "/" + request_id,
            headers={**headers, "Idempotency-Key": str(uuid.uuid4())},
            json=body,
        )
    ).status_code == 409
    assert (await iw.client.get(path, headers=iw.auth())).json()[0]["answered"]
    current = (await iw.client.get(f"{CASES}/{row['id']}", headers=iw.auth("soc"))).json()
    assert current["state"] == "NEEDS_INFORMATION"
    assert current["version"] == row["version"] + 1


async def test_case_contact_information_does_not_reach_bank_owner(iw: IntegrationWorld) -> None:
    row = await opened(iw, contact=True)
    row = await act(iw, row, action="transition", state="IN_REVIEW", reason="review_started")
    response = await iw.client.post(
        f"{CASES}/{row['id']}/actions",
        headers={
            **iw.auth("soc"),
            "Idempotency-Key": str(uuid.uuid4()),
        },
        json={"action": "request_information", "question": "caller_request", "expected_version": 2},
    )
    assert response.status_code == 409
    assert "channel_unavailable" in response.text
    assert (
        await iw.client.get(
            f"{ROOT}/reports/{row['report_id']}/information-requests", headers=iw.auth()
        )
    ).status_code == 404
    assert iw.adapter.messages == {}


@pytest.mark.parametrize("state", ["IN_REVIEW", "ESCALATED", "RESOLVED", "CLOSED"])
async def test_outstanding_information_survives_active_review_but_not_case_closure(
    iw: IntegrationWorld, state: str
) -> None:
    row = await opened(iw)
    row = await act(iw, row, action="transition", state="IN_REVIEW", reason="review_started")
    row = await act(iw, row, action="request_information", question="caller_request")
    path = f"{ROOT}/reports/{row['report_id']}/information-requests"
    question = (await iw.client.get(path, headers=iw.auth())).json()[0]
    row = await act(iw, row, action="transition", state="IN_REVIEW", reason="needs_followup")
    if state != "IN_REVIEW":
        row = await act(iw, row, action="transition", state=state, reason="review_complete")
    headers = {**iw.auth(), "Idempotency-Key": str(uuid.uuid4())}
    body = {
        "body": "The caller asked to install remote access software.",
        "confirmed_demo_submission": True,
    }
    response = await iw.client.post(path + "/" + question["id"], headers=headers, json=body)
    current = (await iw.client.get(f"{CASES}/{row['id']}", headers=iw.auth("soc"))).json()
    assert current["state"] == state, "An owner reply must not undo an officer's transition"
    if state in {"RESOLVED", "CLOSED"}:
        assert response.status_code == 409
        assert response.json() == {"detail": "case_information_closed"}
        assert current["version"] == row["version"]
        assert not (await iw.client.get(path, headers=iw.auth())).json()[0]["answered"]
        return
    assert response.status_code == 200
    assert current["version"] == row["version"] + 1
    assert (
        await iw.client.post(path + "/" + question["id"], headers=headers, json=body)
    ).json() == (response.json())
    assert (await iw.client.get(path, headers=iw.auth())).json()[0]["answered"]
    history = (await iw.client.get(f"{CASES}/{row['id']}/history", headers=iw.auth("soc"))).json()[
        "items"
    ]
    assert history[-1]["code"] == "INFORMATION_RECEIVED"
    assert history[-1]["state"] == state
    assert history[-1]["actor_role"] == "owner"
    # The completed question no longer leaves the case permanently unable to
    # request additional information after the analyst resumed active review.
    next_question = await act(iw, current, action="request_information", question="remote_access")
    assert next_question["state"] == "NEEDS_INFORMATION"


async def test_case_cursor_authentication_and_stable_pagination(iw: IntegrationWorld) -> None:
    first = await opened(iw)
    async with iw.factory() as session:
        session.add(
            FraudCase(
                id=uuid.uuid4(),
                report_id=uuid.uuid4(),
                source="owner_demo",
                category="other",
                state="NEW",
                version=1,
                expires_at=utcnow() + timedelta(days=30),
            )
        )
        await session.commit()
    page = (await iw.client.get(CASES + "?limit=1", headers=iw.auth("soc"))).json()
    cursor = page["next_cursor"]
    assert cursor
    next_page = (
        await iw.client.get(CASES, params={"cursor": cursor}, headers=iw.auth("soc"))
    ).json()
    assert next_page["items"][0]["id"] == first["id"]
    assert next_page["next_cursor"] is None
    for value, headers in (
        (cursor + "x", iw.auth("soc")),
        (cursor, iw.auth("soc", iw.recipient.id)),
    ):
        assert (
            await iw.client.get(CASES, params={"cursor": value}, headers=headers)
        ).status_code == 400


async def test_case_retention_hides_content_then_purges_audit(iw: IntegrationWorld) -> None:
    row = await opened(iw)
    await act(iw, row, action="note", body="This synthetic note will expire soon.")
    async with iw.factory() as session:
        note = await session.scalar(select(CaseContent))
        assert note
        note.expires_at = utcnow() - timedelta(seconds=1)
        await session.commit()
    assert (await iw.client.get(f"{CASES}/{row['id']}/notes", headers=iw.auth("soc"))).json()[
        "items"
    ] == []
    async with iw.factory() as session:
        await expire_cases(session)
        assert await session.scalar(select(func.count()).select_from(CaseContent)) == 0
        stored = await session.get(FraudCase, uuid.UUID(row["id"]))
        assert stored
        stored.expires_at = utcnow() - timedelta(seconds=1)
        await session.commit()
    assert (await iw.client.get(f"{CASES}/{row['id']}", headers=iw.auth("soc"))).status_code == 410
    async with iw.factory() as session:
        await expire_cases(session)
        assert await session.scalar(select(func.count()).select_from(CaseEvent)) == 0


@pytest.mark.skipif(not os.getenv("BCC_TEST_DATABASE_URL"), reason="requires PostgreSQL row locks")
async def test_case_concurrent_optimistic_updates_have_one_winner(iw: IntegrationWorld) -> None:
    row = await opened(iw)

    async def update() -> int:
        response = await iw.client.post(
            f"{CASES}/{row['id']}/actions",
            headers={
                **iw.auth("soc"),
                "Idempotency-Key": str(uuid.uuid4()),
            },
            json={"action": "assign", "assignee": "demo_analyst_b", "expected_version": 1},
        )
        return response.status_code

    assert sorted(await asyncio.gather(update(), update())) == [200, 409]

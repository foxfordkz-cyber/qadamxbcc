import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import fakeredis
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.kz import make_kz_iban
from app.core.resources import Resources
from app.main import create_app
from app.models import Account, EdgeType, GraphEdge, RiskEvent, Transaction, TransactionStatus

API = "/api/v1"
DAY = datetime(2026, 11, 13, 9, 0, tzinfo=UTC)
NIGHT = "2026-11-12T21:30:00+00:00"  # 02:30 Asia/Almaty
CLEAN = {
    "caller_claims_bank_or_police": False,
    "asked_to_move_to_safe_account": False,
    "asked_to_keep_secret_or_install_app": False,
    "initiated_by_customer": True,
    "knows_recipient_personally": True,
}


class World:
    def __init__(
        self,
        client: AsyncClient,
        accounts: dict[str, Account],
        session_factory: async_sessionmaker[AsyncSession],
    ) -> None:
        self.client = client
        self.acc = accounts
        self.sessions = session_factory

    async def expire_hold(self, transaction_id: str) -> None:
        async with self.sessions() as session:
            tx = await session.get(Transaction, uuid.UUID(transaction_id))
            assert tx is not None
            tx.cooling_until = datetime.now(UTC) - timedelta(seconds=1)
            await session.commit()

    def id(self, name: str) -> str:
        return str(self.acc[name].id)

    async def evaluate(self, sender: str, recipient: str, amount: int, **kw: Any) -> Any:
        body: dict[str, Any] = {
            "sender_id": self.id(sender),
            "recipient_id": self.id(recipient),
            "amount": str(amount),
        }
        body.update(kw)
        resp = await self.client.post(f"{API}/transfers/evaluate", json=body)
        assert resp.status_code == 200, resp.text
        return resp.json()


NAMES = ["alice", "bob", "victim", "scammer", "dana", "hub", "cashout"] + [
    f"feeder{i}" for i in range(12)
]


@pytest.fixture
async def world(session_factory: async_sessionmaker[AsyncSession]) -> AsyncIterator[World]:
    accounts: dict[str, Account] = {}
    async with session_factory() as session:
        for n, name in enumerate(NAMES, start=1):
            accounts[name] = Account(
                iin=f"9001013{n:05d}",
                iban=make_kz_iban(f"{n:013d}"),
                phone=f"+7701{n:07d}",
                full_name=f"{name.capitalize()} Testov",
                device_id=f"dev-{name}",
                avg_tx_amount=Decimal("40000"),
            )
        session.add_all(accounts.values())
        await session.flush()
        # pre-existing relationship persisted in DB → must be hydrated into the graph
        session.add(
            GraphEdge(
                source_id=accounts["alice"].id,
                target_id=accounts["bob"].id,
                edge_type=EdgeType.TRANSFER,
                weight=30_000.0,
                tx_count=2,
                last_seen_at=DAY - timedelta(days=3),
            )
        )
        await session.commit()

    redis = fakeredis.FakeAsyncRedis()
    settings = Settings(database_url="sqlite+aiosqlite:///:memory:")
    resources = Resources.build(settings, session_factory=session_factory, redis=redis)
    app = create_app(settings, resources)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield World(client, accounts, session_factory)
    await redis.aclose()


async def test_legit_p2p_approved_and_persisted(
    world: World, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    data = await world.evaluate("alice", "bob", 25_000)

    assert data["status"] == "approved"
    assert data["risk_score"] == 0
    assert data["is_new_recipient"] is False  # hydrated from graph_edges
    assert data["latency_ms"] < 50
    assert data["recipient"]["display_name"] == "Bob T."
    assert data["recipient"]["iban_masked"].endswith(world.acc["bob"].iban[-4:])
    assert data["cooling_off_until"] is None

    async with session_factory() as session:
        tx = await session.get(Transaction, uuid.UUID(data["transaction_id"]))
        assert tx is not None
        assert tx.status is TransactionStatus.APPROVED
        edge = (
            await session.execute(
                select(GraphEdge).where(GraphEdge.source_id == world.acc["alice"].id)
            )
        ).scalar_one()
        assert edge.tx_count == 3
        assert edge.weight == pytest.approx(55_000)


async def test_biometrics_and_ml_response(world: World) -> None:
    data = await world.evaluate(
        "victim",
        "scammer",
        120_000,
        occurred_at=DAY.isoformat(),
        context={
            "active_call": True,
            "pasted_recipient": True,
            "typing_duration_ms": 12_000,
            "recipient_input_length": 12,
            "hesitation_ms": 8000,
            "hesitation_count": 3,
        },
    )
    assert data["status"] == "cooling_off"
    assert 0 <= data["ml_score"] <= 100
    assert data["ml_explanation_method"] == "tree_path_probability"
    assert data["ml_model_version"].startswith("bcc-synthetic-rf-")
    assert len(data["ml_contributors"]) == 5
    assert data["layer_latency_ms"]["ml"] > 0
    for contributor in data["ml_contributors"]:
        assert contributor["label_kk"]
        assert contributor["label_ru"]
        assert isinstance(contributor["contribution"], (float, int))
    reason = next(r for r in data["reasons"] if r["code"] == "PASTED_DURING_CALL")
    assert reason["reason_kk"] == ("Реквизиттер белсенді қоңырау кезінде алмасу буферінен қойылды")
    assert reason["reason_ru"] == ("Реквизиты вставлены из буфера обмена во время активного звонка")
    feed = (await world.client.get(f"{API}/soc/feed")).json()
    assert "PASTED_DURING_CALL" in {r["code"] for r in feed["items"][0]["reasons"]}
    paste_only = await world.evaluate(
        "alice",
        "bob",
        1000,
        occurred_at=DAY.isoformat(),
        context={"pasted_recipient": True},
    )
    assert paste_only["status"] == "approved"
    assert "PASTED_DURING_CALL" not in {r["code"] for r in paste_only["reasons"]}


async def test_social_engineering_cooling_off_then_red_flag_blocks(world: World) -> None:
    data = await world.evaluate(
        "victim",
        "scammer",
        1_500_000,
        context={"active_call": True, "from_deposit": True},
    )
    assert data["status"] == "cooling_off"
    assert 40 <= data["risk_score"] <= 74
    assert {"ACTIVE_CALL", "DEPOSIT_WITHDRAWAL", "SOCIAL_ENGINEERING_PATTERN"} <= {
        r["code"] for r in data["reasons"]
    }
    assert len(data["reasons_kk"]) == len(data["reasons_ru"]) == len(data["reasons"])
    until = datetime.fromisoformat(data["cooling_off_until"])
    assert timedelta(minutes=14) < until - datetime.now(UTC) <= timedelta(minutes=15)

    tx_id = data["transaction_id"]
    answers = CLEAN | {"caller_claims_bank_or_police": True, "initiated_by_customer": False}
    resp = await world.client.post(
        f"{API}/transfers/{tx_id}/resolve-cooling", json={"answers": answers}
    )
    assert resp.status_code == 200, resp.text
    res = resp.json()
    assert res["status"] == "blocked"
    assert res["risk_score"] >= 90
    assert res["red_flags"] == ["caller_claims_bank_or_police", "initiated_by_customer"]
    assert "полиции" in res["reasons_ru"][0]
    assert "полиция" in res["reasons_kk"][0]

    again = await world.client.post(
        f"{API}/transfers/{tx_id}/resolve-cooling", json={"answers": CLEAN}
    )
    assert again.status_code == 409


async def test_cooling_off_clean_questionnaire_releases_funds(world: World) -> None:
    data = await world.evaluate(
        "victim", "scammer", 900_000, context={"active_call": True, "from_deposit": True}
    )
    assert data["status"] == "cooling_off"

    resp = await world.client.post(
        f"{API}/transfers/{data['transaction_id']}/resolve-cooling", json={"answers": CLEAN}
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "cooling_off"
    assert resp.json()["verification_answers"] == CLEAN
    await world.expire_hold(data["transaction_id"])
    resp = await world.client.post(
        f"{API}/transfers/{data['transaction_id']}/resolve-cooling", json={"answers": CLEAN}
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"
    assert resp.json()["red_flags"] == []

    # released transfer is now part of the graph → recipient no longer "new"
    follow_up = await world.evaluate("victim", "scammer", 10_000)
    assert follow_up["is_new_recipient"] is False


async def test_new_device_at_night_detected_from_device_id(world: World) -> None:
    data = await world.evaluate(
        "dana", "bob", 120_000, device_id="unknown-android", occurred_at=NIGHT
    )
    assert data["is_new_device"] is True
    assert data["status"] == "cooling_off"
    codes = {r["code"] for r in data["reasons"]}
    assert {"NEW_DEVICE", "NIGHT_HOURS", "ACCOUNT_TAKEOVER_PATTERN"} <= codes


async def test_drop_hub_blocked_and_visible_in_soc(world: World) -> None:
    start = datetime.now(UTC) - timedelta(minutes=28)
    for i in range(12):
        fed = await world.evaluate(
            f"feeder{i}",
            "hub",
            90_000,
            occurred_at=(start + timedelta(minutes=2 * i)).isoformat(),
        )
        assert fed["status"] != "blocked"
        if fed["status"] == "cooling_off":
            await world.expire_hold(fed["transaction_id"])
            await world.client.post(
                f"{API}/transfers/{fed['transaction_id']}/resolve-cooling",
                json={"answers": CLEAN},
            )
    # Settlements happen at server time, so the attempted cashout must follow those releases.
    cash = await world.evaluate("hub", "cashout", 1_000_000)
    assert "SENDER_PASS_THROUGH" in {r["code"] for r in cash["reasons"]}
    assert cash["status"] == "cooling_off"
    # The coached mule clears the questionnaire: money actually leaves the hub.
    await world.expire_hold(cash["transaction_id"])
    released = await world.client.post(
        f"{API}/transfers/{cash['transaction_id']}/resolve-cooling", json={"answers": CLEAN}
    )
    assert released.json()["status"] == "approved"

    blocked = await world.evaluate("victim", "hub", 250_000)
    assert blocked["status"] == "blocked"
    assert blocked["risk_score"] >= 75
    assert "DROP_HUB_FAN_IN" in {r["code"] for r in blocked["reasons"]}
    assert blocked["recipient_graph"]["suspected_mule"] is True

    # SOC graph around the hub — React Flow shape
    resp = await world.client.get(f"{API}/soc/graph/{world.id('hub')}", params={"depth": 1})
    assert resp.status_code == 200
    graph = resp.json()
    nodes = {n["id"]: n for n in graph["nodes"]}
    assert nodes[world.id("hub")]["data"]["role"] == "center"
    assert nodes[world.id("hub")]["position"] == {"x": 0.0, "y": 0.0}
    assert nodes[world.id("hub")]["data"]["in_degree"] == 12
    assert world.id("feeder0") in nodes
    edge = next(e for e in graph["edges"] if e["source"] == world.id("feeder0"))
    assert edge["target"] == world.id("hub")
    assert edge["data"]["edge_type"] == "transfer"
    assert edge["label"].endswith("₸")

    # from a feeder's perspective the hub is highlighted as a hub
    resp = await world.client.get(f"{API}/soc/graph/{world.id('feeder3')}")
    feeder_graph = resp.json()
    hub_node = next(n for n in feeder_graph["nodes"] if n["id"] == world.id("hub"))
    assert hub_node["data"]["role"] == "hub"
    into_hub = [e for e in feeder_graph["edges"] if e["target"] == world.id("hub")]
    assert into_hub
    assert all(e["animated"] and e["data"]["highlight"] for e in into_hub)

    # SOC feed: newest first, blocked item carries bilingual reasons
    feed = (await world.client.get(f"{API}/soc/feed", params={"status": "blocked"})).json()
    top = feed["items"][0]
    assert top["transaction_id"] == blocked["transaction_id"]
    assert top["recipient"]["full_name"] == "Hub Testov"
    assert top["reasons"][0]["reason_kk"]
    assert top["reasons"][0]["reason_ru"]
    assert feed["stats"]["blocked"] >= 1
    assert feed["stats"]["total"] >= 14


async def test_feed_since_cursor_and_stats(world: World) -> None:
    first = (await world.client.get(f"{API}/soc/feed")).json()
    assert first["items"] == []
    assert first["stats"]["total"] == 0

    await world.evaluate("alice", "bob", 1_000)
    after = (
        await world.client.get(f"{API}/soc/feed", params={"since": first["server_time"]})
    ).json()
    assert len(after["items"]) == 1
    assert after["stats"]["approved"] == 1
    assert after["stats"]["avg_latency_ms"] > 0

    empty = (
        await world.client.get(f"{API}/soc/feed", params={"since": after["server_time"]})
    ).json()
    assert empty["items"] == []


async def test_recipient_lookup_by_phone_and_iban(world: World) -> None:
    for key, value in (
        ("recipient_phone", world.acc["bob"].phone),
        ("recipient_iban", world.acc["bob"].iban),
    ):
        resp = await world.client.post(
            f"{API}/transfers/evaluate",
            json={"sender_id": world.id("alice"), key: value, "amount": "500"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["recipient"]["id"] == world.id("bob")


@pytest.mark.parametrize(
    ("patch", "expected"),
    [
        ({"amount": "0"}, 422),
        ({"amount": "-5"}, 422),
        ({"recipient_phone": "+77010000002"}, 422),  # two recipient identifiers
        ({"currency": "USD"}, 422),
        ({"recipient_id": "self"}, 422),  # sender == recipient
        ({"sender_id": str(uuid.uuid4())}, 404),
        ({"recipient_id": str(uuid.uuid4())}, 404),
    ],
)
async def test_evaluate_validation(world: World, patch: dict[str, str], expected: int) -> None:
    body = {"sender_id": world.id("alice"), "recipient_id": world.id("bob"), "amount": "100"}
    if patch.get("recipient_id") == "self":
        patch = {"recipient_id": world.id("alice")}
    body.update(patch)
    resp = await world.client.post(f"{API}/transfers/evaluate", json=body)
    assert resp.status_code == expected, resp.text


async def test_unknown_resources_return_404(world: World) -> None:
    missing = uuid.uuid4()
    resp = await world.client.post(
        f"{API}/transfers/{missing}/resolve-cooling", json={"answers": CLEAN}
    )
    assert resp.status_code == 404
    resp = await world.client.get(f"{API}/soc/graph/{missing}")
    assert resp.status_code == 404


async def test_resolve_on_approved_transfer_conflicts(world: World) -> None:
    data = await world.evaluate("alice", "bob", 1_000)
    resp = await world.client.post(
        f"{API}/transfers/{data['transaction_id']}/resolve-cooling", json={"answers": CLEAN}
    )
    assert resp.status_code == 409


async def test_accounts_created_after_startup_join_the_graph(
    world: World, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """Regression (live smoke): seeding while the API runs must not leave graph blind spots."""
    async with session_factory() as session:
        late = [
            Account(
                iin=f"9502024{n:05d}",
                iban=make_kz_iban(f"{900 + n:013d}"),
                phone=f"+7705{n:07d}",
                full_name=f"Late{n} Mule",
                device_id="shared-burner",
                avg_tx_amount=Decimal("40000"),
            )
            for n in range(3)
        ]
        session.add_all(late)
        await session.commit()
    mule0 = str(late[0].id)

    data = await world.evaluate("alice", "bob", 1_000, recipient_id=mule0)
    shared = next(r for r in data["reasons"] if r["code"] == "RECIPIENT_SHARED_DEVICE")
    assert shared["evidence"]["n"] == 2

    graph = (await world.client.get(f"{API}/soc/graph/{mule0}", params={"depth": 1})).json()
    labels = {n["id"]: n["data"]["label"] for n in graph["nodes"]}
    assert labels[mule0] == "Late0 Mule"
    assert labels[world.id("alice")] == "Alice Testov"
    assert {e["data"]["edge_type"] for e in graph["edges"]} == {"transfer", "shared_device"}

    lonely = (await world.client.get(f"{API}/soc/graph/{late[1].id}", params={"depth": 1})).json()
    assert next(n for n in lonely["nodes"] if n["id"] == str(late[1].id))["data"]["label"] == (
        "Late1 Mule"
    )


async def test_concurrent_idempotency_replays_original_and_rejects_different_payload(
    world: World,
) -> None:
    request_id = str(uuid.uuid4())
    body = {
        "request_id": request_id,
        "sender_id": world.id("alice"),
        "recipient_id": world.id("bob"),
        "amount": "1000",
    }
    responses = await asyncio.gather(
        *[world.client.post(f"{API}/transfers/evaluate", json=body) for _ in range(4)]
    )
    assert all(r.status_code == 200 for r in responses)
    assert all(r.json() == responses[0].json() for r in responses)
    assert responses[0].json()["transaction_id"] == request_id
    async with world.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Transaction)) == 1
        edge = (
            await session.execute(
                select(GraphEdge).where(GraphEdge.source_id == world.acc["alice"].id)
            )
        ).scalar_one()
        assert edge.tx_count == 3
        assert edge.weight == 31_000
    conflict = await world.client.post(f"{API}/transfers/evaluate", json=body | {"amount": "1001"})
    assert conflict.status_code == 409


async def test_audit_survives_detail_and_feed_with_original_ml_and_biometrics(world: World) -> None:
    data = await world.evaluate(
        "victim",
        "scammer",
        900_000,
        context={
            "active_call": True,
            "pasted_recipient": True,
            "typing_duration_ms": 1200,
            "hesitation_count": 2,
        },
    )
    detail = (await world.client.get(f"{API}/transfers/{data['transaction_id']}")).json()
    item = (await world.client.get(f"{API}/soc/feed")).json()["items"][0]
    for read in (detail, item):
        assert read["ml_score"] == data["ml_score"]
        assert read["ml_contributors"] == data["ml_contributors"]
        assert read["context"]["pasted_recipient"] is True
        assert read["context"]["typing_duration_ms"] == 1200
        amount_reason = next(r for r in read["reasons"] if r["code"] == "AMOUNT_SPIKE")
        assert amount_reason["evidence"]["ratio"]


async def test_cancel_is_terminal_idempotent_and_feed_cursor_includes_lifecycle_change(
    world: World,
) -> None:
    data = await world.evaluate(
        "victim", "scammer", 900_000, context={"active_call": True, "from_deposit": True}
    )
    cursor = (await world.client.get(f"{API}/soc/feed")).json()["server_time"]
    path = f"{API}/transfers/{data['transaction_id']}"
    cancelled = await world.client.post(f"{path}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["cooling_off_until"] is None
    again = await world.client.post(f"{path}/cancel")
    assert again.status_code == 200
    assert again.json()["resolved_at"] == cancelled.json()["resolved_at"]
    assert (
        await world.client.post(f"{path}/resolve-cooling", json={"answers": CLEAN})
    ).status_code == 409
    feed = (await world.client.get(f"{API}/soc/feed", params={"since": cursor})).json()
    assert [i["transaction_id"] for i in feed["items"]] == [data["transaction_id"]]
    assert feed["stats"]["cancelled"] == 1
    assert feed["stats"]["cancelled_amount"] == "900000.00"
    async with world.sessions() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(RiskEvent)
                .where(RiskEvent.rule_code == "CUSTOMER_CANCELLED")
            )
            == 1
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(GraphEdge)
                .where(GraphEdge.source_id == world.acc["victim"].id)
            )
            == 0
        )


async def test_hold_never_releases_early_and_final_resolution_replays_once(world: World) -> None:
    data = await world.evaluate(
        "victim", "scammer", 900_000, context={"active_call": True, "from_deposit": True}
    )
    path = f"{API}/transfers/{data['transaction_id']}/resolve-cooling"
    for _ in range(2):
        response = await world.client.post(path, json={"answers": CLEAN})
        assert response.json()["status"] == "cooling_off"
        assert response.json()["resolved_at"] is None
    await world.expire_hold(data["transaction_id"])
    responses = await asyncio.gather(
        *[world.client.post(path, json={"answers": CLEAN}) for _ in range(2)]
    )
    assert all(r.json()["status"] == "approved" for r in responses)
    assert responses[0].json()["resolved_at"] == responses[1].json()["resolved_at"]
    async with world.sessions() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(RiskEvent)
                .where(RiskEvent.rule_code == "QUESTIONNAIRE_VERIFIED")
            )
            == 1
        )
        edge = (
            await session.execute(
                select(GraphEdge).where(GraphEdge.source_id == world.acc["victim"].id)
            )
        ).scalar_one()
        assert edge.tx_count == 1
    changed = CLEAN | {"asked_to_move_to_safe_account": True}
    assert (await world.client.post(path, json={"answers": changed})).status_code == 409


async def test_new_soc_flag_prevents_release_after_deadline(world: World) -> None:
    data = await world.evaluate(
        "victim", "scammer", 900_000, context={"active_call": True, "from_deposit": True}
    )
    await world.expire_hold(data["transaction_id"])
    async with world.sessions() as session:
        recipient = await session.get(Account, world.acc["scammer"].id)
        assert recipient is not None
        recipient.is_flagged = True
        await session.commit()
    response = await world.client.post(
        f"{API}/transfers/{data['transaction_id']}/resolve-cooling", json={"answers": CLEAN}
    )
    assert response.json()["status"] == "blocked"
    assert response.json()["reasons"][0]["code"] == "RECIPIENT_FLAGGED_AT_RELEASE"


async def test_request_id_cannot_collide_with_existing_non_idempotent_transaction(
    world: World,
) -> None:
    data = await world.evaluate("alice", "bob", 1000)
    response = await world.client.post(
        f"{API}/transfers/evaluate",
        json={
            "request_id": data["transaction_id"],
            "sender_id": world.id("alice"),
            "recipient_id": world.id("bob"),
            "amount": "1000",
        },
    )
    assert response.status_code == 409


async def test_unknown_recipient_is_contextual_questionnaire_signal(world: World) -> None:
    pressured = await world.evaluate("victim", "scammer", 900_000, context={"active_call": True})
    answers = CLEAN | {"knows_recipient_personally": False}
    response = await world.client.post(
        f"{API}/transfers/{pressured['transaction_id']}/resolve-cooling", json={"answers": answers}
    )
    assert response.json()["status"] == "blocked"
    assert response.json()["red_flags"] == ["unknown_recipient_under_pressure"]
    # Large new-device payment without a call/deposit does not turn unknown payees into fraud.
    ordinary = await world.evaluate("dana", "bob", 900_000, context={"is_new_device": True})
    assert ordinary["status"] == "cooling_off"
    await world.expire_hold(ordinary["transaction_id"])
    released = await world.client.post(
        f"{API}/transfers/{ordinary['transaction_id']}/resolve-cooling", json={"answers": answers}
    )
    assert released.json()["status"] == "approved"
    assert released.json()["red_flags"] == []

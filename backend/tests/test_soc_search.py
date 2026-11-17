"""Search and paging operate on persisted history, not the latest browser window."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from app.models import Account, RiskEvent, Transaction, TransactionStatus
from tests.test_api import API, World
from tests.test_api import world as world


async def history(world: World, count: int = 65) -> list[str]:
    timestamp = datetime.now(UTC) - timedelta(hours=1)
    ids: list[str] = []
    async with world.sessions() as session:
        for index in range(1, count + 1):
            identity = uuid.UUID(int=index)
            ids.append(str(identity))
            session.add(
                Transaction(
                    id=identity,
                    sender_id=world.acc["alice"].id,
                    recipient_id=world.acc["bob"].id,
                    amount=Decimal("1000"),
                    status=TransactionStatus.APPROVED,
                    risk_score=0,
                    device_id="synthetic-device",
                    created_at=timestamp,
                    updated_at=timestamp,
                )
            )
        await session.commit()
    return list(reversed(ids))


async def get_feed(world: World, **params: Any) -> Any:
    response = await world.client.get(f"{API}/soc/feed", params=params)
    assert response.status_code == 200, response.text
    return response.json()


async def test_pages_reach_older_history_without_duplicates_and_keep_global_stats(
    world: World,
) -> None:
    expected = await history(world)
    received: list[str] = []
    for offset in (0, 20, 40, 60):
        page = await get_feed(world, offset=offset, limit=20)
        received.extend(item["transaction_id"] for item in page["items"])
        assert page["pagination"] == {
            "total_filtered": 65,
            "offset": offset,
            "limit": 20,
            "has_more": offset < 60,
        }
        assert page["stats"]["total"] == 65
        assert page["stats"]["approved"] == 65
    assert received == expected  # equal timestamps have a deterministic UUID tie break
    empty = await get_feed(world, offset=100, limit=20)
    assert empty["items"] == []
    assert empty["pagination"]["total_filtered"] == 65
    assert empty["pagination"]["has_more"] is False


async def test_search_matches_both_party_names_in_kazakh_and_russian_case(world: World) -> None:
    await history(world, 2)
    async with world.sessions() as session:
        sender = await session.get(Account, world.acc["alice"].id)
        recipient = await session.get(Account, world.acc["bob"].id)
        assert sender is not None
        assert recipient is not None
        sender.full_name = "Әлия Құрманғали"
        recipient.full_name = "Сергей Николаев"
        await session.commit()
    for term in ("  ӘЛИЯ  ", "қҰрМаНҒаЛи", "СЕРГЕЙ", "николаев"):
        result = await get_feed(world, q=term, limit=1)
        assert len(result["items"]) == 1
        assert result["pagination"]["total_filtered"] == 2
        assert result["pagination"]["has_more"] is True
    empty = await get_feed(world, q="Ешкім")
    assert empty["items"] == []
    assert empty["stats"]["total"] == 2
    assert (await get_feed(world, q="   "))["pagination"]["total_filtered"] == 2


async def test_literal_wildcards_and_sql_syntax_never_expand_name_search(world: World) -> None:
    await history(world, 1)
    ordinary = await world.evaluate("victim", "scammer", 1000)
    async with world.sessions() as session:
        recipient = await session.get(Account, world.acc["bob"].id)
        assert recipient is not None
        recipient.full_name = "Клиент_100%/тест"
        await session.commit()
    for term in ("%", "_", "/", "100%/"):
        result = await get_feed(world, q=term)
        assert result["pagination"]["total_filtered"] == 1
        assert result["items"][0]["transaction_id"] != ordinary["transaction_id"]
    result = await get_feed(world, q="%' OR 1=1 --")
    assert result["pagination"]["total_filtered"] == 0
    assert result["stats"]["total"] == 2


async def test_uuid_search_and_combined_status_score_filters(world: World) -> None:
    await history(world, 55)
    held = await world.evaluate(
        "victim", "scammer", 900_000, context={"active_call": True, "from_deposit": True}
    )
    for query in (held["transaction_id"], held["transaction_id"].upper().replace("-", "")):
        result = await get_feed(world, q=query)
        assert [row["transaction_id"] for row in result["items"]] == [held["transaction_id"]]
    result = await get_feed(world, status="cooling_off", min_score=40, q="Scammer")
    assert result["pagination"]["total_filtered"] == 1
    assert result["stats"]["approved"] == 55
    assert result["stats"]["total"] == 56
    assert (await get_feed(world, status="approved", q=held["transaction_id"]))["items"] == []
    assert (await get_feed(world, status="cooling_off", min_score=100))["items"] == []


async def test_lifecycle_updates_sort_first_and_since_remains_update_filter(world: World) -> None:
    ids = await history(world, 3)
    before = (await get_feed(world))["server_time"]
    async with world.sessions() as session:
        oldest = await session.get(Transaction, uuid.UUID(ids[-1]))
        assert oldest is not None
        oldest.created_at -= timedelta(days=3)
        oldest.status = TransactionStatus.CANCELLED
        oldest.resolved_at = datetime.now(UTC)
        oldest.updated_at = oldest.resolved_at
        await session.commit()
    page = await get_feed(world, limit=1)
    assert page["items"][0]["transaction_id"] == ids[-1]
    assert page["items"][0]["status"] == "cancelled"
    changed = await get_feed(world, since=before)
    assert [row["transaction_id"] for row in changed["items"]] == [ids[-1]]
    assert changed["pagination"]["total_filtered"] == 1


@pytest.mark.parametrize(
    "params",
    [
        {"q": "а" * 129},
        {"q": "name\x00"},
        {"offset": -1},
        {"offset": 100_001},
        {"offset": "1.5"},
        {"limit": 0},
        {"limit": 201},
        {"status": "unknown"},
    ],
)
async def test_feed_rejects_unbounded_or_invalid_queries(
    world: World, params: dict[str, Any]
) -> None:
    response = await world.client.get(f"{API}/soc/feed", params=params)
    assert response.status_code == 422


async def test_global_hub_metric_deduplicates_recipients_and_excludes_scam_blocks(
    world: World,
) -> None:
    ids = await history(world, 3)
    async with world.sessions() as session:
        for index, identity in enumerate(ids):
            tx = await session.get(Transaction, uuid.UUID(identity))
            assert tx is not None
            tx.status = TransactionStatus.BLOCKED
            if index == 2:
                tx.recipient_id = world.acc["scammer"].id
            for code in (
                ("DROP_HUB_FAN_IN", "RECIPIENT_MANY_SENDERS")
                if index < 2
                else ("SOCIAL_ENGINEERING_PATTERN",)
            ):
                session.add(
                    RiskEvent(
                        transaction_id=tx.id,
                        layer="graph",
                        rule_code=code,
                        score_delta=10,
                        reason_kk="Синтетикалық тексеру",
                        reason_ru="Синтетическая проверка",
                    )
                )
        await session.commit()
    for params in ({"limit": 1}, {"q": "no match"}, {"status": "approved"}):
        result = await get_feed(world, **params)
        assert result["stats"]["blocked"] == 3
        assert result["stats"]["blocked_hubs"] == 1


async def test_transfer_timestamps_survive_detail_cancel_and_legacy_replay(world: World) -> None:
    request_id = str(uuid.uuid4())
    request = {
        "request_id": request_id,
        "context": {"active_call": True, "from_deposit": True},
    }
    held = await world.evaluate("victim", "scammer", 900_000, **request)
    assert held["created_at"] == held["updated_at"]
    created_at = datetime.fromisoformat(held["created_at"])
    assert created_at.tzinfo is not None
    cancelled = await world.client.post(f"{API}/transfers/{request_id}/cancel", json={})
    assert cancelled.status_code == 200
    current = cancelled.json()
    assert current["created_at"] == held["created_at"]
    assert datetime.fromisoformat(current["updated_at"]) >= created_at
    assert current["updated_at"] == current["resolved_at"]
    detail = (await world.client.get(f"{API}/transfers/{request_id}")).json()
    assert detail["created_at"] == current["created_at"]
    assert detail["updated_at"] == current["updated_at"]
    # Stored snapshots created before this API extension are still replayable.
    async with world.sessions() as session:
        tx = await session.get(Transaction, uuid.UUID(request_id))
        assert tx is not None
        legacy = dict(tx.evaluation_snapshot)
        legacy.pop("created_at")
        legacy.pop("updated_at")
        tx.evaluation_snapshot = legacy
        await session.commit()
    replay = await world.evaluate("victim", "scammer", 900_000, **request)
    assert replay["created_at"] == held["created_at"]
    assert replay["updated_at"] == held["updated_at"]

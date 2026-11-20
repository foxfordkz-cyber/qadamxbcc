"""Silent alarm («тихий код»): the client's hidden signal stops the transfer."""

from tests import test_api
from tests.test_api import World

world = test_api.world


async def test_silent_alarm_blocks_even_a_clean_transfer(world: World) -> None:
    clean = await world.evaluate("alice", "bob", 5_000)
    assert clean["status"] == "approved"
    data = await world.evaluate("alice", "bob", 5_000, context={"duress": True})
    assert data["status"] == "blocked"
    assert data["risk_score"] == 100
    reason = next(r for r in data["reasons"] if r["code"] == "DURESS_SIGNAL")
    assert reason["score_delta"] == 100
    assert "тихий сигнал" in reason["reason_ru"]
    assert data["context"]["duress"] is True


async def test_without_the_signal_nothing_changes(world: World) -> None:
    data = await world.evaluate("alice", "bob", 5_000, context={"duress": False})
    assert "DURESS_SIGNAL" not in {r["code"] for r in data["reasons"]}

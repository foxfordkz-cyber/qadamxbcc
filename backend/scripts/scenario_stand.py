"""Replay labelled synthetic transfers against the actual rules, graph and trained model."""

import argparse
import asyncio
import json
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fakeredis import FakeAsyncRedis

from app.models import TransactionStatus
from app.services.antifraud import AntifraudEngine, TransferContext
from app.services.graph import GraphStore

DAY = datetime(2026, 11, 20, 9, tzinfo=UTC)
ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Story:
    key: str
    title: str
    fraud: bool
    count: int
    typical_amount: int
    known: bool = False
    call: bool = False
    deposit: bool = False
    paste: bool = False
    group: str = ""


# Labels describe the customer's intent and never enter the scorer. Variants include
# low-observability scams and legitimate transactions with overlapping risk signals.
STORIES = (
    Story("bank", "Звонок от службы безопасности", True, 8, 165_000, call=True, paste=True),
    Story("police", "Звонок от имени полиции", True, 8, 210_000, call=True),
    Story("reserve", "«Безопасный счёт»", True, 8, 720_000, call=True, deposit=True),
    Story("invest", "Ложный брокер", True, 8, 360_000, call=True, deposit=True),
    Story("relative", "Срочная помощь родственнику", True, 7, 140_000, call=True),
    Story("market", "Ложная предоплата на площадке", True, 7, 45_000, call=True, paste=True),
    Story("loan", "Кредит под диктовку", True, 7, 840_000, call=True, paste=True),
    Story("hub", "Перевод на транзитный дроп-счёт", True, 7, 115_000, group="transit"),
    Story("family", "Регулярная помощь семье", False, 10, 32_000, known=True),
    Story(
        "seller",
        "Оплата знакомому продавцу во время звонка",
        False,
        10,
        18_000,
        known=True,
        call=True,
    ),
    Story("purchase", "Крупная плановая покупка", False, 10, 390_000, known=True),
    Story(
        "savings", "Пополнение своей карты с депозита", False, 10, 175_000, known=True, deposit=True
    ),
    Story("friend", "Первый перевод другу", False, 10, 22_000),
    Story("collection", "Общий сбор без вывода денег", False, 10, 16_000, group="collection"),
)


@dataclass(frozen=True)
class Result:
    id: str
    story: str
    fraud: bool
    decision: str
    score: int
    signals: list[str]


def transfer(story: Story, index: int) -> TransferContext:
    identity = f"{story.key}-{index + 1:02}"
    # Some callers hang up before payment; a purchase at night and an honest first
    # payment while talking make the legitimate control group harder as well.
    call = story.call
    if story.key in {"market", "relative"} and index % 4 == 0:
        call = False
    if story.key == "friend" and index % 6 == 0:
        call = True
    return TransferContext(
        tx_id=identity,
        sender_id=f"{identity}-payer",
        recipient_id=f"{identity}-payee",
        amount=story.typical_amount * (0.72 + index * 0.065),
        sender_avg_amount=28_000 + (index % 4) * 8_000,
        device_id=f"{identity}-device",
        occurred_at=DAY + timedelta(hours=12 if index % 5 == 4 else 0, minutes=index),
        active_call=call,
        from_deposit=story.deposit,
        pasted_recipient=story.paste and index % 3 != 0,
        typing_duration_ms=1_600 + index * 410,
        hesitation_count=index % 4,
        is_new_device=index % 7 == 5,
    )


async def history(engine: AntifraudEngine, story: Story, tx: TransferContext) -> None:
    if story.known:
        engine.graph.add_transfer(
            tx.sender_id,
            tx.recipient_id,
            28_000,
            ts=(tx.occurred_at - timedelta(days=30)).timestamp(),
        )
    if not story.group:
        return
    for i in range(12):
        incoming = replace(
            tx,
            tx_id=f"{tx.tx_id}-in-{i}",
            sender_id=f"{tx.tx_id}-member-{i}",
            amount=90_000,
            occurred_at=tx.occurred_at - timedelta(minutes=28 - i),
        )
        await engine.record_settled(incoming)
        engine.apply_transfer(incoming)
    if story.group == "transit":
        outgoing = replace(
            tx,
            tx_id=f"{tx.tx_id}-out",
            sender_id=tx.recipient_id,
            recipient_id=f"{tx.tx_id}-cashout",
            amount=930_000,
            occurred_at=tx.occurred_at - timedelta(minutes=6),
        )
        await engine.record_settled(outgoing)
        engine.apply_transfer(outgoing)


async def replay() -> list[Result]:
    redis = FakeAsyncRedis()
    try:
        engine = AntifraudEngine(redis, GraphStore())
        results = []
        for story in STORIES:
            for i in range(story.count):
                tx = transfer(story, i)
                await history(engine, story, tx)
                evaluation = await engine.evaluate(tx)
                results.append(
                    Result(
                        tx.tx_id,
                        story.key,
                        story.fraud,
                        evaluation.decision.value,
                        evaluation.score,
                        [r.code for r in evaluation.reasons],
                    )
                )
        return results
    finally:
        await redis.aclose()


def stopped(case: Result) -> bool:
    return case.decision in {TransactionStatus.COOLING_OFF.value, TransactionStatus.BLOCKED.value}


def summary(results: list[Result]) -> dict[str, dict[str, int]]:
    return {
        story.key: {
            decision: sum(r.story == story.key and r.decision == decision for r in results)
            for decision in ("approved", "cooling_off", "blocked")
        }
        for story in STORIES
    }


def report(results: list[Result]) -> str:
    lines = [
        "# Проверка антифрода на 120 синтетических переводах",
        "",
        "Каждый сценарий использует отдельные счета. Проверяются настоящие правила, граф и ML. "
        "Хранилище Redis заменено на fakeredis. Метка сценария не передаётся в движок.",
        "",
        "Пауза и блокировка считаются вмешательством. Для честного перевода "
        "любое вмешательство считается ложной тревогой. Цифры описывают только этот набор.",
        "",
        "| Сценарий | Истина | Всего | Одобрено | Пауза | Блок | Пропущено | Ложные тревоги |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for story in STORIES:
        group = [r for r in results if r.story == story.key]
        counts = [
            sum(r.decision == d for r in group) for d in ("approved", "cooling_off", "blocked")
        ]
        label = "Мошенничество" if story.fraud else "Честный перевод"
        lines.append(
            f"| {story.title} | {label} | {len(group)} | {counts[0]} | {counts[1]} "
            f"| {counts[2]} | {counts[0] if story.fraud else '—'} "
            f"| {'—' if story.fraud else counts[1] + counts[2]} |"
        )
    fraud = sum(r.fraud for r in results)
    detected = sum(r.fraud and stopped(r) for r in results)
    alarms = sum(not r.fraud and stopped(r) for r in results)
    lines += [
        "",
        f"Остановлено {detected} из {fraud} мошеннических переводов. "
        f"Пропущено {fraud - detected}. Ложных тревог — {alarms} из {len(results) - fraud}.",
        "",
        "Повторить из `backend/` — `uv run python -m scripts.scenario_stand`. "
        "Решение и коды причин для каждого примера есть в [JSON](evidence/scenario_stand.json).",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Refresh checked-in evidence")
    args = parser.parse_args()
    results = asyncio.run(replay())
    rendered = report(results)
    if args.write:
        (ROOT / "frontend/src/lib/scenario-summary.json").write_text(
            json.dumps(summary(results), indent=2) + "\n", encoding="utf-8"
        )
        (ROOT / "docs/SCENARIO_STAND.md").write_text(rendered, encoding="utf-8")
        (ROOT / "docs/evidence/scenario_stand.json").write_text(
            json.dumps([asdict(r) for r in results], ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(rendered)


if __name__ == "__main__":
    main()

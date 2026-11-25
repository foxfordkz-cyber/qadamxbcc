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
    amount_tiyn: int
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


async def evaluate_case(engine: AntifraudEngine, story: Story, tx: TransferContext) -> Result:
    await history(engine, story, tx)
    evaluation = await engine.evaluate(tx)
    return Result(
        tx.tx_id,
        story.key,
        story.fraud,
        evaluation.decision.value,
        evaluation.score,
        round(tx.amount * 100),
        [r.code for r in evaluation.reasons],
    )


async def replay() -> list[Result]:
    redis = FakeAsyncRedis()
    try:
        engine = AntifraudEngine(redis, GraphStore())
        results = []
        for story in STORIES:
            for i in range(story.count):
                results.append(await evaluate_case(engine, story, transfer(story, i)))
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


# Outcomes independently reproduced from ea6280c before changing the engine.
# Neither the scenario labels nor these earlier scores are passed to evaluate().
OLD_MISSES = {"relative-01": 20, "relative-05": 37, "market-01": 10, "market-05": 20}
OLD_HONEST_HOLDS = frozenset({"seller-06", "savings-06", "friend-01", "friend-07"})


@dataclass(frozen=True)
class CallComparison:
    amount: int
    ordinary: Result
    reported: Result


async def compare_call_request(case_id: str, *, honest_twin: bool = False) -> CallComparison:
    key, variant = case_id.split("-")
    story = next(s for s in STORIES if s.key == key)
    # The seller control was on the phone in the original set. Both paired arms
    # below observe the call already over. The four historical misses already
    # had active_call=False, so none of their telemetry is rewritten.
    tx = replace(transfer(story, int(variant) - 1), active_call=False)
    if honest_twin:
        story = replace(story, key="honest-twin", fraud=False)
        tx = replace(
            tx,
            tx_id="honest-twin",
            sender_id="honest-twin-payer",
            recipient_id="honest-twin-payee",
            device_id="honest-twin-device",
        )

    async def isolated(observed: TransferContext) -> Result:
        redis = FakeAsyncRedis()
        try:
            return await evaluate_case(AntifraudEngine(redis, GraphStore()), story, observed)
        finally:
            await redis.aclose()

    ordinary = await isolated(tx)
    reported = await isolated(replace(tx, payment_requested_after_call=True))
    return CallComparison(round(tx.amount), ordinary, reported)


async def call_comparisons() -> dict[str, CallComparison]:
    pairs = {
        key: await compare_call_request(key)
        for key in (*OLD_MISSES, "family-01", "seller-01", "friend-02")
    }
    pairs["honest-twin"] = await compare_call_request("relative-05", honest_twin=True)
    return pairs


def decision_cell(result: Result) -> str:
    names = {"approved": "одобрено", "cooling_off": "пауза", "blocked": "блок"}
    return f"{names[result.decision]} · {result.score}"


def call_scorecard(calls: dict[str, CallComparison]) -> list[dict[str, object]]:
    return [
        {
            "id": key,
            "amount": pair.amount,
            "baseline": {"score": OLD_MISSES[key], "decision": "approved"},
            "unchanged": {"score": pair.ordinary.score, "decision": pair.ordinary.decision},
            "reported": {"score": pair.reported.score, "decision": pair.reported.decision},
        }
        for key, pair in calls.items()
        if key in OLD_MISSES
    ]


def report(results: list[Result], calls: dict[str, CallComparison]) -> str:
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
        "",
        "## Повтор четырёх ранее одобренных переводов",
        "",
        "В версии [ea6280c](https://github.com/foxfordkz-cyber/qadamxbcc/blob/ea6280c/"
        "docs/evidence/scenario_stand.json) все четыре были одобрены. В обоих повторах никто "
        "не разговаривает по телефону в момент платежа. В последнем столбце клиент сообщил, "
        "что во время недавнего звонка его попросили сделать именно этот перевод. "
        "В остальных столбцах у движка нет сведений о предшествующем звонке.",
        "",
        "| Перевод | Сумма, ₸ | В ea6280c | Сейчас, исходный запрос | Сейчас, с ответом |",
        "| --- | ---: | --- | --- | --- |",
    ]
    for key, old_score in OLD_MISSES.items():
        pair = calls[key]
        amount = f"{pair.amount:,}".replace(",", " ")
        lines.append(
            f"| {key} | {amount} | одобрено · {old_score} | {decision_cell(pair.ordinary)} "
            f"| {decision_cell(pair.reported)} |"
        )
    honest_holds = {r.id for r in results if not r.fraud and stopped(r)}
    lines += [
        "",
        f"Из 60 исходных честных переводов движок задержал {len(OLD_HONEST_HOLDS)} до изменения "
        f"и {len(honest_holds)} после. Дополнительно задержано "
        f"{len(honest_holds - OLD_HONEST_HOLDS)}, снято прежних ограничений — "
        f"{len(OLD_HONEST_HOLDS - honest_holds)}.",
        "",
        "### Отдельные честные контрольные примеры",
        "",
        "Одинаковые платёжные признаки в каждой паре. Слева клиент не сообщал о просьбе "
        "(в том числе если недавний звонок был о другом), справа он явно указал на просьбу "
        "об этом платеже. Для знакомого продавца в обеих пробах звонок уже завершён. "
        "Эти пробы не входят в основной набор из 120 переводов.",
        "",
        "| Честная ситуация | Без сообщения | Клиент сообщил о просьбе |",
        "| --- | --- | --- |",
    ]
    controls = {
        "family-01": "Перевод знакомому родственнику",
        "seller-01": "Оплата знакомому продавцу",
        "friend-02": "Первый перевод новому другу",
        "honest-twin": "Первый перевод новому знакомому ночью, 4,9 средней суммы",
    }
    for key, label in controls.items():
        pair = calls[key]
        lines.append(
            f"| {label} | {decision_cell(pair.ordinary)} | {decision_cell(pair.reported)} |"
        )
    lines += [
        "",
        "Последняя строка воспроизводит платёжные признаки relative-05 с честным намерением. "
        "У движка нет способа различить эти намерения по одинаковым данным. Пауза на честной "
        "просьбе к новому получателю отражает цену вмешательства. Для оценки частоты таких "
        "случаев потребуются размеченные операции банка.",
        "",
        "## Если этому получателю уже отправляли деньги",
        "",
        "Клиент сообщает, что его попросили сделать перевод по телефону. "
        "Если за всю историю у него был один платёж этому получателю, он прошёл в последние "
        "24 часа и был меньше обычной суммы клиента, новая просьба перевести хотя бы три "
        "обычные суммы отправляет операцию на дополнительную проверку. Для сравнения берётся "
        "средняя сумма переводов клиента. Отсчёт суток начинается с банковского зачисления.",
        "",
        "Для отдельной проверки заранее зафиксированы 12 пар с ситуациями на маркетплейсе "
        "или в семье. Каждой мошеннической просьбе соответствует честная покупка или помощь. "
        "Четыре пары имеют полностью одинаковые наблюдаемые признаки в обеих операциях.",
        "",
        "| На 24 дополнительных примерах | До изменения (c654fbb) | Сейчас |",
        "| --- | ---: | ---: |",
        "| Мошеннические просьбы на паузе, из 12 | 2 | 8 |",
        "| Пропущенные мошеннические просьбы, из 12 | 10 | 4 |",
        "| Честные переводы на паузе, из 12 | 0 | 1 |",
        "| Заблокированные операции, из 24 | 0 | 0 |",
        "",
        "Честный клиент в паре `family-rent-twin` тоже подтвердил, что его попросили "
        "перевести деньги по телефону. Его операция получила ту же паузу. У остальных "
        "трёх пар с одинаковыми признаками оба перевода прошли. На исходном наборе из "
        "120 переводов все сохранённые решения и баллы воспроизводятся. Оба набора "
        "синтетические и не оценивают долю ложных тревог среди клиентов банка.",
        "",
        "Повторить из `backend/` — `uv run python -m scripts.payee_followup_replay`. "
        "Для проверки исходного результата запустите тот же "
        "[сценарий](../backend/scripts/payee_followup_replay.py) с движком из `c654fbb`.",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Refresh checked-in evidence")
    args = parser.parse_args()
    results = asyncio.run(replay())
    calls = asyncio.run(call_comparisons())
    rendered = report(results, calls)
    if args.write:
        (ROOT / "frontend/src/lib/scenario-summary.json").write_text(
            json.dumps(summary(results), indent=2) + "\n", encoding="utf-8"
        )
        (ROOT / "frontend/src/lib/post-call-replay.json").write_text(
            json.dumps(call_scorecard(calls), indent=2) + "\n", encoding="utf-8"
        )
        (ROOT / "docs/SCENARIO_STAND.md").write_text(rendered, encoding="utf-8")
        detail = json.dumps([asdict(r) for r in results], ensure_ascii=False, indent=2) + "\n"
        for path in ("docs/evidence/scenario_stand.json", "frontend/src/lib/scenario-details.json"):
            (ROOT / path).write_text(detail, encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()

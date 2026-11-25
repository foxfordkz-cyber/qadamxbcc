"""Read-only exhibits on the synthetic jury host."""

import asyncio
import json
from functools import lru_cache
from html import escape
from pathlib import Path
from typing import TypedDict, cast

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from scripts.payee_followup_replay import PAIRS, Arm, Pair, evaluate_arm

router = APIRouter(prefix="/jury/results", default_response_class=HTMLResponse)
gate = asyncio.Semaphore(1)
labels = {
    "cooling_off": "Пауза / Кідіріс",
    "approved": "Одобрено / Мақұлданды",
    "blocked": "Блок / Бұғатталды",
}

pair_titles = {
    "market-reservation": "Маркетплейстегі бронь / Бронь на маркетплейсе",
    "family-travel": "Жолға көмек / Помощь на поездку",
    "market-delivery": "Жеткізу / Доставка",
    "family-rent-twin": "Пәтерақы / Аренда жилья",
    "market-tools": "Құрал-сайман / Покупка инструментов",
    "family-first": "Туысқа алғашқы аударым / Первый перевод родственнику",
    "market-first": "Алғашқы сатып алу / Первая покупка",
    "family-unreported-twin": "Отбасына көмек / Помощь семье",
    "market-no-call-twin": "Сатушыға алғашқы төлем / Первый платёж продавцу",
    "family-small-twin": "Шағын аударым / Небольшой перевод семье",
    "market-old-payee": "Таныс сатушы / Знакомый продавец",
    "family-gift": "Сыйлық / Подарок близкому",
}


def tenge(value: int) -> str:
    return f"{value:,} ₸".replace(",", " ")


def pair_button(pair: Pair) -> str:
    return (
        f'<button formaction="/jury/results/pair?scenario={pair.name}">'
        f"{escape(pair_titles[pair.name])}<br><b>{tenge(pair.amount)}</b></button>"
    )


def input_history(arm: Arm) -> str:
    prior = (
        f"{tenge(arm.prior)} · {arm.hours_ago} сағ бұрын / ч назад"
        if arm.prior
        else "Алғашқы аударым / Первый перевод"
    )
    answer = "Иә / Да" if arm.requested else "Жоқ / Нет"
    return (
        f"<dl><dt>Алушыға бұрын аударылған / Предыдущий платёж получателю</dt><dd>{prior}</dd>"
        "<dt>Клиент осы аударымды телефонмен сұрағанын хабарлады ма? / "
        "Клиент сообщил, что его попросили об этом переводе по телефону?</dt>"
        f"<dd>{answer}</dd></dl>"
    )


def page(content: str) -> str:
    return (
        """<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saq Bol · Стенд</title>
<style>body{background:#eff5f2;color:#12392e;font:17px/1.5 system-ui;margin:auto;
max-width:820px;padding:24px}
section,details{background:white;border-radius:16px;padding:16px;margin:12px 0}
summary,button{cursor:pointer}
button{padding:12px;border:0;border-radius:10px;background:#075b46;color:white;
font:inherit}
.pair,.choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));
gap:12px}.choices{margin-top:12px}.choices button{text-align:left}
dt{color:#435e53}dd{margin:2px 0 12px;font-weight:650}
a{color:#075b46}</style>
<a href="/jury">← Қазылар әмияны / Кошелёк жюри</a>"""
        + content
        + "</html>"
    )


class Sample(TypedDict):
    id: str
    fraud: bool
    decision: str
    signals: list[str]


@lru_cache(maxsize=1)
def dataset() -> list[Sample]:
    paths = [
        Path(__file__).resolve().parents[2] / "scenario_stand.json",
        Path(__file__).resolve().parents[3] / "docs/evidence/scenario_stand.json",
    ]
    source = next(p for p in paths if p.is_file())
    return cast(list[Sample], json.loads(source.read_text(encoding="utf-8")))


@lru_cache(maxsize=1)
def signal_names() -> dict[str, list[str]]:
    root = Path(__file__).resolve()
    paths = (
        root.parents[2] / "scenario-signals.json",
        root.parents[3] / "frontend/src/lib/scenario-signals.json",
    )
    source = next(path for path in paths if path.is_file())
    return cast(dict[str, list[str]], json.loads(source.read_text(encoding="utf-8")))


@router.get("")
async def results() -> str:
    rows = dataset()
    groups = [
        (
            "Алаяқтық тоқтатылды / Вмешательства при мошенничестве",
            [r for r in rows if r["fraud"] and r["decision"] != "approved"],
        ),
        (
            "Өтіп кетті / Пропущенное мошенничество",
            [r for r in rows if r["fraud"] and r["decision"] == "approved"],
        ),
        (
            "Артық кідіріс / Лишние задержки",
            [r for r in rows if not r["fraud"] and r["decision"] != "approved"],
        ),
    ]
    body = (
        '<p><a href="/jury/trial">Өз CSV файлыңызды тексеру / Проверить свой CSV</a></p>'
        f"<h1>Банк нәтижесі / Результаты банка</h1><p>{len(rows)} синтетикалық сценарий / "
        "синтетических сценариев. Вмешательство включает паузу и блокировку.</p>"
    )
    for title, group in groups:
        body += f"<details><summary><b>{len(group)}</b> · {title}</summary><ul>"
        for row in group:
            signals = escape(
                " · ".join(" / ".join(signal_names().get(code, [code])) for code in row["signals"])
                or "Белгі анықталмады / Признаков не выявлено"
            )
            body += f"<li>{escape(row['id'])} · {labels[row['decision']]} · {signals}</li>"
        body += "</ul></details>"
    return page(
        body + '<form method="post" action="/jury/results/pair">'
        "<h2>Неге тоқтады? / Почему остановился перевод?</h2>"
        "<p>Бірдей сомадағы екі аударымды салыстырыңыз. / "
        "Выберите пару и сравните два перевода на одну сумму.</p>"
        + f"<p>{escape(pair_titles[PAIRS[0].name])} · {tenge(PAIRS[0].amount)}</p>"
        + "<button>Екеуін тексеру / Проверить оба перевода</button>"
        + "<details><summary>Басқа жұпты таңдау / Выбрать другую пару</summary>"
        + '<div class="choices">'
        + "".join(pair_button(pair) for pair in PAIRS[1:])
        + "</div></details></form>"
    )


@router.post("/pair")
async def pair_result(scenario: str = PAIRS[0].name) -> str:
    pair = next((item for item in PAIRS if item.name == scenario), None)
    if pair is None:
        raise HTTPException(404, "scenario_not_found")
    if gate.locked():
        raise HTTPException(429, "stand_busy", headers={"Retry-After": "2"})
    body = (
        f"<h1>{escape(pair_titles[pair.name])}</h1>"
        f"<p>Аударым сомасы / Сумма каждого перевода: <b>{tenge(pair.amount)}</b><br>"
        f"Жіберушінің орташа аударымы / Средний перевод отправителя: {tenge(pair.average)}</p>"
    )
    if pair.honest == pair.fraud:
        body += (
            "<p>Екі оқиғаның белгілері бірдей. Осы деректермен оларды ажырату мүмкін емес. / "
            "В этих двух историях движок видит "
            "одинаковые признаки. По ним различить истории невозможно.</p>"
        )
    body += '<div class="pair">'
    async with gate:
        for fraud in (False, True):
            decision = await evaluate_arm(pair, fraud)
            story = (
                "Алаяқтық сценарий / Мошеннический сценарий"
                if fraud
                else "Қалыпты аударым / Обычный перевод"
            )
            body += (
                f"<section><h2>{story}</h2>{input_history(pair.fraud if fraud else pair.honest)}"
                f"<h3>{labels[decision.decision.value]}</h3><ul>"
            )
            for reason in decision.reasons:
                body += f"<li>{escape(reason.reason_ru)} / {escape(reason.reason_kk)}</li>"
            if not decision.reasons:
                body += "<li>Движок не вернул признаков риска / Тәуекел белгілері анықталмады</li>"
            body += "</ul></section>"
    return page(body + '</div><a href="/jury/results">← Нәтижелер / Результаты</a>')

"""Read-only exhibits on the synthetic jury host."""

import asyncio
import json
from functools import lru_cache
from html import escape
from pathlib import Path
from typing import TypedDict, cast

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from scripts.payee_followup_replay import PAIRS, evaluate_arm

router = APIRouter(prefix="/jury/results", default_response_class=HTMLResponse)
gate = asyncio.Semaphore(1)
labels = {
    "cooling_off": "Пауза / Кідіріс",
    "approved": "Одобрено / Мақұлданды",
    "blocked": "Блок / Бұғатталды",
}


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
.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:12px}
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
        "<p>96 000 ₸ · Маркетплейстегі бронь / Бронь на маркетплейсе.</p>"
        "<button>Екеуін тексеру / Проверить оба перевода</button></form>"
    )


@router.post("/pair")
async def pair_result() -> str:
    pair = PAIRS[0]
    if gate.locked():
        raise HTTPException(429, "stand_busy", headers={"Retry-After": "2"})
    amount = format(pair.amount, ",").replace(",", " ")
    body = (
        f"<h1>{amount} ₸ · Бронь на маркетплейсе / Маркетплейстегі бронь</h1>"
        "<p>В обоих случаях этому получателю уже перевели 1 200 ₸ два часа назад. "
        "Екі жағдайда да осы алушыға екі сағат бұрын 1 200 ₸ аударылды.</p><div class=pair>"
    )
    async with gate:
        for fraud in (False, True):
            decision = await evaluate_arm(pair, fraud)
            story = (
                "Клиент сообщил о просьбе по телефону / Клиент телефондағы өтінішті хабарлады"
                if fraud
                else "Обычная покупка / Қалыпты сатып алу"
            )
            body += (
                f"<section><h2>{story}</h2><strong>{labels[decision.decision.value]}</strong><ul>"
            )
            for reason in decision.reasons:
                body += f"<li>{escape(reason.reason_ru)} / {escape(reason.reason_kk)}</li>"
            if not decision.reasons:
                body += "<li>Движок не вернул признаков риска / Тәуекел белгілері анықталмады</li>"
            body += "</ul></section>"
    return page(body + '</div><a href="/jury/results">← Нәтижелер / Результаты</a>')

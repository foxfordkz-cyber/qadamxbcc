"""Measure end-to-end HTTP + PostgreSQL + Redis latency of POST /transfers/evaluate.

Run against a seeded backend that is NOT the live demo (every request is persisted):

    uv run python -m scripts.benchmark_http --base-url http://localhost:8765 \
        --requests 600 --concurrency 8 [--api-key ...]   # or BCC_API_KEY

Traffic: with --accounts (a JSON list of {"id", "phone"} for seeded accounts) 80% are
ordinary transfers between rotating account pairs, 10% the social-engineering preset and
10% the drop-hub preset, each from a rotating sender. Without it, only the three demo
presets from one sender are sent; one account then reaches the per-account scoring
history cap (512 rows) and the server correctly answers 503 (fail-closed).
Latency is the client-observed wall time of one request; errors include non-200 answers,
transport failures and malformed responses. Warmup finishes before measurement starts.
The main percentiles include failures; success-only percentiles are separate. An empty
sample has null percentiles, never a misleading zero. This script exits nonzero on errors.
"""

import argparse
import asyncio
import json
import os
import statistics
import time
import uuid
from collections import Counter
from decimal import Decimal
from typing import Any

import httpx

from app.schemas.transfers import TransferEvaluateResponse

SENDER = "00000000-0000-4000-8000-000000000001"
PRESETS: list[tuple[str, dict[str, Any]]] = [
    (
        "normal",
        {
            "recipient_phone": "+77010000002",
            "amount": "25000",
            "context": {"active_call": False, "from_deposit": False, "is_new_recipient": False},
        },
    ),
    (
        "scam",
        {
            "recipient_phone": "+77010000003",
            "amount": "900000",
            "context": {"active_call": True, "from_deposit": True, "is_new_recipient": True},
        },
    ),
    (
        "hub",
        {
            "recipient_phone": "+77010000004",
            "amount": "250000",
            "context": {"active_call": False, "from_deposit": False, "is_new_recipient": True},
        },
    ),
]


def _pct(values: list[float], q: int) -> float | None:
    if len(values) < 2:
        return values[0] if values else None
    return statistics.quantiles(values, n=100, method="inclusive")[q - 1]


def _summary(values: list[float]) -> dict[str, float | int | None]:
    result: dict[str, float | int | None] = {"samples": len(values)}
    for q in (50, 95, 99):
        value = _pct(values, q)
        result[f"p{q}_ms"] = round(value, 2) if value is not None else None
    result["max_ms"] = round(max(values), 2) if values else None
    return result


def _payload(i: int, accounts: list[dict[str, str]]) -> tuple[str, dict[str, Any]]:
    if not accounts:
        name, body = PRESETS[i % len(PRESETS)]
        return name, {"sender_id": SENDER, **body}
    sender = accounts[i % len(accounts)]
    if i % 10 == 0:
        name, body = PRESETS[1]
    elif i % 10 == 5:
        name, body = PRESETS[2]
    else:
        recipient = accounts[(i * 7 + 3) % len(accounts)]
        if recipient["id"] == sender["id"]:
            recipient = accounts[(i * 7 + 4) % len(accounts)]
        name = "ordinary"
        body = {"recipient_phone": recipient["phone"], "amount": str(5000 + (i % 40) * 500)}
    if sender["phone"] == body["recipient_phone"]:
        sender = accounts[(i + 1) % len(accounts)]
    return name, {"sender_id": sender["id"], **body}


async def run(
    base_url: str,
    api_key: str | None,
    requests: int,
    concurrency: int,
    warmup: int,
    accounts: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    if requests < 1 or concurrency < 1 or warmup < 0:
        raise ValueError("requests/concurrency must be positive and warmup nonnegative")
    if accounts is not None and (
        len(accounts) < 2
        or len({a["id"] for a in accounts}) != len(accounts)
        or len({a["phone"] for a in accounts}) != len(accounts)
    ):
        raise ValueError("accounts must contain at least two distinct IDs and phone numbers")
    headers = {"X-BCC-API-Key": api_key} if api_key else {}
    latencies: list[float] = []
    successes: list[float] = []
    statuses: Counter[str] = Counter()
    errors: Counter[str] = Counter()
    warmup_errors: Counter[str] = Counter()

    async with httpx.AsyncClient(base_url=base_url, headers=headers, timeout=15) as client:

        async def phase(start_index: int, count: int, *, measured: bool) -> float:
            queue: asyncio.Queue[int] = asyncio.Queue()
            for i in range(start_index, start_index + count):
                queue.put_nowait(i)

            async def worker() -> None:
                while True:
                    try:
                        i = queue.get_nowait()
                    except asyncio.QueueEmpty:
                        return
                    name, body = _payload(i, accounts or [])
                    payload = {"request_id": str(uuid.uuid4()), **body}
                    start = time.perf_counter()
                    failure: str | None = None
                    status = ""
                    try:
                        resp = await client.post("/api/v1/transfers/evaluate", json=payload)
                        if resp.status_code != 200:
                            failure = f"http_{resp.status_code}"
                        else:
                            data = TransferEvaluateResponse.model_validate_json(resp.content)
                            status = data.status.value
                            if (
                                str(data.transaction_id) != payload["request_id"]
                                or data.amount != Decimal(payload["amount"])
                                or status
                                not in {
                                    "approved",
                                    "cooling_off",
                                    "blocked",
                                }
                            ):
                                failure = "invalid_response"
                    except httpx.HTTPError as exc:
                        failure = f"transport_{type(exc).__name__}"
                    except ValueError:
                        failure = "invalid_response"
                    elapsed = (time.perf_counter() - start) * 1000
                    if not measured:
                        if failure:
                            warmup_errors[failure] += 1
                        continue
                    latencies.append(elapsed)
                    if failure:
                        errors[failure] += 1
                    else:
                        statuses[f"{name}:{status}"] += 1
                        successes.append(elapsed)

            wall = time.perf_counter()
            await asyncio.gather(*(worker() for _ in range(min(concurrency, count))))
            return time.perf_counter() - wall

        await phase(0, warmup, measured=False)
        wall = await phase(warmup, requests, measured=True)

    total = requests
    failed = sum(errors.values())
    return {
        "scope": "HTTP response including persistence (client-observed; see target setup)",
        "base_url": base_url,
        "requests": total,
        "warmup": warmup,
        "concurrency": concurrency,
        "load_model": "closed_loop; at most concurrency in flight; queue wait excluded",
        "traffic": "mixed accounts" if accounts else "three presets, one sender",
        "quantiles": "inclusive linear interpolation; all measured requests",
        **_summary(latencies),
        "successful_requests": _summary(successes),
        "error_rate": failed / total,
        "errors": dict(errors),
        "warmup_errors": dict(warmup_errors),
        "measured_seconds": round(wall, 3),
        "throughput_rps": round(total / wall, 1),
        "status_mix": dict(sorted(statuses.items())),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--api-key", default=os.environ.get("BCC_API_KEY"))
    parser.add_argument("--requests", type=int, default=600)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--warmup", type=int, default=30)
    parser.add_argument("--accounts", help="JSON file: list of {id, phone} seeded accounts")
    args = parser.parse_args()
    accounts = None
    if args.accounts:
        with open(args.accounts, encoding="utf-8-sig") as fh:
            accounts = json.load(fh)
    result = asyncio.run(
        run(args.base_url, args.api_key, args.requests, args.concurrency, args.warmup, accounts)
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if result["errors"] or result["warmup_errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

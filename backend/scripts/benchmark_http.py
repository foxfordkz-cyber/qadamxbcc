"""Measure end-to-end HTTP + PostgreSQL + Redis latency of POST /transfers/evaluate.

Run against a seeded backend that is NOT the live demo (every request is persisted):

    uv run python -m scripts.benchmark_http --base-url http://localhost:8765 \
        --requests 600 --concurrency 8 [--api-key ...]   # or BCC_API_KEY

Traffic: with --accounts (a JSON list of {"id", "phone"} for seeded accounts) 80% are
ordinary transfers between rotating account pairs, 10% the social-engineering preset and
10% the drop-hub preset, each from a rotating sender. Without it, only the three demo
presets from one sender are sent; one account then reaches the per-account scoring
history cap (512 rows) and the server correctly answers 503 (fail-closed).
Latency is the client-observed wall time of one request; errors are non-200 answers and
transport failures. Output is JSON with p50/p95/p99, error rate and the status mix.
"""

import argparse
import asyncio
import json
import os
import statistics
import time
import uuid
from collections import Counter
from typing import Any

import httpx

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


def _pct(values: list[float], q: int) -> float:
    if len(values) < 2:
        return values[0] if values else 0.0
    return statistics.quantiles(values, n=100, method="inclusive")[q - 1]


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
    return name, {"sender_id": sender["id"], **body}


async def run(
    base_url: str,
    api_key: str | None,
    requests: int,
    concurrency: int,
    warmup: int,
    accounts: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    headers = {"X-BCC-API-Key": api_key} if api_key else {}
    latencies: list[float] = []
    statuses: Counter[str] = Counter()
    errors: Counter[str] = Counter()
    queue: asyncio.Queue[int] = asyncio.Queue()
    for i in range(warmup + requests):
        queue.put_nowait(i)

    async with httpx.AsyncClient(base_url=base_url, headers=headers, timeout=15) as client:

        async def worker() -> None:
            while True:
                try:
                    i = queue.get_nowait()
                except asyncio.QueueEmpty:
                    return
                name, body = _payload(i, accounts or [])
                payload = {"request_id": str(uuid.uuid4()), **body}
                start = time.perf_counter()
                try:
                    resp = await client.post("/api/v1/transfers/evaluate", json=payload)
                    elapsed = (time.perf_counter() - start) * 1000
                    outcome = (
                        f"{name}:{resp.json()['status']}"
                        if resp.status_code == 200
                        else f"http_{resp.status_code}"
                    )
                except httpx.HTTPError as exc:
                    elapsed = (time.perf_counter() - start) * 1000
                    outcome = f"transport_{type(exc).__name__}"
                if i < warmup:
                    continue
                if outcome.startswith(("http_", "transport_")):
                    errors[outcome] += 1
                else:
                    statuses[outcome] += 1
                    latencies.append(elapsed)

        wall = time.perf_counter()
        await asyncio.gather(*(worker() for _ in range(concurrency)))
        wall = time.perf_counter() - wall

    total = requests
    failed = sum(errors.values())
    return {
        "scope": "HTTP + PostgreSQL + Redis (client-observed)",
        "base_url": base_url,
        "requests": total,
        "warmup": warmup,
        "concurrency": concurrency,
        "traffic": "mixed accounts" if accounts else "three presets, one sender",
        "p50_ms": round(_pct(latencies, 50), 2),
        "p95_ms": round(_pct(latencies, 95), 2),
        "p99_ms": round(_pct(latencies, 99), 2),
        "max_ms": round(max(latencies), 2) if latencies else None,
        "error_rate": round(failed / total, 4) if total else 0.0,
        "errors": dict(errors),
        "throughput_rps": round((total + warmup) / wall, 1),
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
        with open(args.accounts, encoding="utf-8") as fh:
            accounts = json.load(fh)
    result = asyncio.run(
        run(args.base_url, args.api_key, args.requests, args.concurrency, args.warmup, accounts)
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

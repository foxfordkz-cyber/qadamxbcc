"""Benchmarks must not turn failed requests or concurrent warmup into good latency."""

import asyncio
import json
from typing import Any

import httpx
import pytest

from scripts import benchmark_http


def valid_response(request: httpx.Request) -> dict[str, Any]:
    body = json.loads(request.content)
    now = "2026-11-20T06:00:00Z"
    return {
        "transaction_id": body["request_id"],
        "amount": body["amount"],
        "status": "approved",
        "created_at": now,
        "updated_at": now,
        "server_time": now,
        "risk_score": 0,
        "ml_contributors": [],
        "headline_kk": "Қауіпсіз",
        "headline_ru": "Одобрен",
        "reasons": [],
        "reasons_kk": [],
        "reasons_ru": [],
        "latency_ms": 1,
        "layer_latency_ms": {},
        "cooling_off_until": None,
        "is_new_recipient": False,
        "is_new_device": False,
        "recipient": {
            "id": benchmark_http.SENDER,
            "display_name": "Synthetic",
            "iban_masked": "••••0002",
        },
        "velocity": {},
        "recipient_graph": {},
        "context": {},
    }


def install_transport(monkeypatch: pytest.MonkeyPatch, handler: Any) -> None:
    client_class = httpx.AsyncClient
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: client_class(transport=transport, **kwargs),
    )


async def test_http_benchmark_finishes_warmup_before_measuring(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = 0
    finished_warmup = 0
    request_ids: set[str] = set()

    async def reply(request: httpx.Request) -> httpx.Response:
        nonlocal started, finished_warmup
        index = started
        started += 1
        request_ids.add(json.loads(request.content)["request_id"])
        if index < 3:
            await asyncio.sleep(0.02 if index == 0 else 0)
            finished_warmup += 1
        else:
            assert finished_warmup == 3
        return httpx.Response(200, json=valid_response(request))

    install_transport(monkeypatch, reply)
    result = await benchmark_http.run("http://test", None, 5, 2, 3)
    assert len(request_ids) == 8
    assert result["samples"] == result["successful_requests"]["samples"] == 5
    assert sum(result["status_mix"].values()) == 5
    assert result["errors"] == result["warmup_errors"] == {}
    assert result["throughput_rps"] > 0


async def test_http_benchmark_keeps_failed_samples_and_reports_no_success_percentiles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    responses = iter(
        [
            httpx.Response(503),
            httpx.Response(200, text="bad json"),
            httpx.Response(200, json={"status": ["approved"]}),
            httpx.Response(429),
        ]
    )
    install_transport(monkeypatch, lambda request: next(responses))
    result = await benchmark_http.run("http://test", None, 3, 1, 1)
    assert result["warmup_errors"] == {"http_503": 1}
    assert result["errors"] == {"invalid_response": 2, "http_429": 1}
    assert result["error_rate"] == 1
    assert result["samples"] == 3
    assert result["successful_requests"] == {
        "samples": 0,
        "p50_ms": None,
        "p95_ms": None,
        "p99_ms": None,
        "max_ms": None,
    }


@pytest.mark.parametrize(("requests", "concurrency", "warmup"), [(0, 1, 0), (1, 0, 0), (1, 1, -1)])
async def test_http_benchmark_rejects_invalid_workload(
    requests: int,
    concurrency: int,
    warmup: int,
) -> None:
    with pytest.raises(ValueError, match="positive"):
        await benchmark_http.run("http://test", None, requests, concurrency, warmup)


async def test_http_benchmark_rejects_single_account_self_transfers() -> None:
    with pytest.raises(ValueError, match="distinct"):
        await benchmark_http.run("http://test", None, 1, 1, 0, [{"id": "a", "phone": "1"}])


@pytest.mark.parametrize("mismatch", ["transaction_id", "amount", "missing_fields"])
async def test_http_benchmark_rejects_incomplete_or_unrelated_success(
    monkeypatch: pytest.MonkeyPatch,
    mismatch: str,
) -> None:
    def reply(request: httpx.Request) -> httpx.Response:
        body = valid_response(request)
        if mismatch == "missing_fields":
            body = {"status": "approved"}
        else:
            body[mismatch] = benchmark_http.SENDER if mismatch == "transaction_id" else "0.01"
        return httpx.Response(200, json=body)

    install_transport(monkeypatch, reply)
    result = await benchmark_http.run("http://test", None, 1, 1, 0)
    assert result["errors"] == {"invalid_response": 1}
    assert result["error_rate"] == 1


def test_http_benchmark_never_sends_presets_to_same_account() -> None:
    accounts = [{"id": "scam", "phone": "+77010000003"}, {"id": "hub", "phone": "+77010000004"}]
    for i in range(30):
        _, body = benchmark_http._payload(i, accounts)
        sender = next(a for a in accounts if a["id"] == body["sender_id"])
        assert sender["phone"] != body["recipient_phone"]

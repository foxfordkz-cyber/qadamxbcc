from datetime import UTC, datetime
from typing import Any

import pytest
from fakeredis import FakeAsyncRedis
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from starlette.responses import Response

from app.mobile_gateway.technical_metrics import (
    TRANSFER_PATH,
    TransferHTTPMetrics,
    bucket_key,
    observe,
    snapshot,
)


async def test_fixed_window_counts_and_latency_buckets() -> None:
    redis = FakeAsyncRedis()
    try:
        now = datetime(2026, 11, 20, 17, 8, tzinfo=UTC)
        minute = int(now.timestamp()) // 60
        await observe(redis, minute - 15, 500, 99999)  # just outside the reporting window
        empty = await snapshot(redis, now)
        assert empty.requests == 0
        assert empty.p95_upper_ms is None
        assert not empty.p95_overflow
        for _ in range(19):
            await observe(redis, minute - 14, 200, 11)
        await observe(redis, minute, 429, 30100)
        first = await snapshot(redis, now)
        assert len(first.buckets) == 15
        assert first.buckets[0].requests == 19
        assert first.buckets[-1].requests == 1
        assert first.requests == 20
        assert first.rate_limited == 1
        assert first.server_errors == 0
        assert first.p95_upper_ms == 15
        assert not first.p95_overflow
        await observe(redis, minute, 503, 30100)
        second = await snapshot(redis, now)
        assert second.p95_overflow
        assert second.p95_upper_ms is None
        assert second.server_errors == 1
        assert 0 < await redis.ttl(bucket_key(minute)) <= 960
    finally:
        await redis.aclose()


async def test_counts_actual_http_attempts_and_unhandled_errors_without_identity() -> None:
    from types import SimpleNamespace

    redis = FakeAsyncRedis(decode_responses=True)
    app = FastAPI()
    app.state.resources = SimpleNamespace(redis=redis)
    app.add_middleware(TransferHTTPMetrics)

    @app.post(TRANSFER_PATH)
    async def transfer(status: int) -> Response:
        if status == 500:
            raise RuntimeError("synthetic backend failure")
        return Response(status_code=status)

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test"
        ) as http:
            for status in [200, 200, 429, 500]:
                assert (
                    await http.post(TRANSFER_PATH, params={"status": status})
                ).status_code == status
            await http.get(TRANSFER_PATH)
            await http.post("/other")
        result = await snapshot(redis, datetime.now(UTC))
        assert (result.requests, result.rate_limited, result.server_errors) == (4, 1, 1)
        for key in await redis.keys("*"):
            assert isinstance(key, str)
            assert key.startswith("saqbol:mobile:transfer_http:v1:")
            for field in await redis.hkeys(key):
                assert isinstance(field, str)
                assert field in {"requests", "429", "5xx"} or field.startswith("ms:")
    finally:
        await redis.aclose()


async def test_unavailable_metrics_do_not_replace_transfer_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from types import SimpleNamespace

    from redis.exceptions import ConnectionError as RedisConnectionError

    from app.mobile_gateway import technical_metrics

    async def unavailable(*args: Any) -> None:
        raise RedisConnectionError()

    monkeypatch.setattr(technical_metrics, "observe", unavailable)
    app = FastAPI()
    app.state.resources = SimpleNamespace(redis=None)
    app.add_middleware(TransferHTTPMetrics)

    @app.post(TRANSFER_PATH)
    async def transfer() -> Response:
        return Response(status_code=201)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        assert (await http.post(TRANSFER_PATH)).status_code == 201

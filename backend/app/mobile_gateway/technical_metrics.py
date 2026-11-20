"""Short-lived, anonymous HTTP metrics at the connected wallet's transfer boundary."""

import asyncio
import math
import time
from bisect import bisect_left
from datetime import UTC, datetime
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from redis.asyncio import Redis
from redis.exceptions import RedisError
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.mobile_gateway.app import IdentityDep

WINDOW = 15
BOUNDS_MS = (1, 2, 5, 10, 15, 20, 30, 50, 75, 100, 150, 250, 500, 1000, 2000, 5000, 10000, 30000)
TRANSFER_PATH = "/mobile/v1/api/transfers/evaluate"


class MinuteBucket(BaseModel):
    minute: datetime
    requests: int = 0
    rate_limited: int = 0
    server_errors: int = 0


class TransferMetrics(BaseModel):
    scope: Literal["wallet_transfer_api"] = "wallet_transfer_api"
    as_of: datetime
    window_minutes: int = WINDOW
    buckets: list[MinuteBucket]
    requests: int
    rate_limited: int
    server_errors: int
    p95_upper_ms: int | None
    p95_overflow: bool


def bucket_key(minute: int) -> str:
    return f"saqbol:mobile:transfer_http:v1:{minute}"


async def observe(redis: Redis, minute: int, status: int, elapsed_ms: float) -> None:
    key = bucket_key(minute)
    async with redis.pipeline(transaction=True) as pipe:
        pipe.hincrby(key, "requests", 1)
        pipe.hincrby(key, f"ms:{bisect_left(BOUNDS_MS, elapsed_ms)}", 1)
        if status == 429:
            pipe.hincrby(key, "429", 1)
        elif 500 <= status < 600:
            pipe.hincrby(key, "5xx", 1)
        pipe.expire(key, (WINDOW + 1) * 60)
        await pipe.execute()


async def snapshot(redis: Redis, now: datetime) -> TransferMetrics:
    end = int(now.timestamp()) // 60
    minutes = range(end - WINDOW + 1, end + 1)
    histogram = [0] * (len(BOUNDS_MS) + 1)
    async with redis.pipeline(transaction=True) as pipe:
        for minute in minutes:
            pipe.hgetall(bucket_key(minute))
        records = await pipe.execute()
    buckets = []
    for minute, record in zip(minutes, records, strict=True):
        # Redis clients may be configured with or without decode_responses.
        data = {k.decode() if isinstance(k, bytes) else k: int(v) for k, v in record.items()}
        for i in range(len(histogram)):
            histogram[i] += data.get(f"ms:{i}", 0)
        buckets.append(
            MinuteBucket(
                minute=datetime.fromtimestamp(minute * 60, UTC),
                requests=data.get("requests", 0),
                rate_limited=data.get("429", 0),
                server_errors=data.get("5xx", 0),
            )
        )
    total = sum(b.requests for b in buckets)
    rank = math.ceil(total * 0.95)
    p95 = None
    overflow = False
    if rank:
        for i, count in enumerate(histogram):
            rank -= count
            if rank <= 0:
                overflow = i == len(BOUNDS_MS)
                p95 = None if overflow else BOUNDS_MS[i]
                break
    return TransferMetrics(
        as_of=now,
        buckets=buckets,
        requests=total,
        rate_limited=sum(b.rate_limited for b in buckets),
        server_errors=sum(b.server_errors for b in buckets),
        p95_upper_ms=p95,
        p95_overflow=overflow,
    )


class TransferHTTPMetrics:
    """Count once at the gateway, including retries and rejections before scoring."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != TRANSFER_PATH:
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status = 500
        finished: float | None = None

        async def timed_send(message: Message) -> None:
            nonlocal status, finished
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)
            if message["type"] == "http.response.body" and not message.get("more_body"):
                finished = time.perf_counter()

        try:
            await self.app(scope, receive, timed_send)
        finally:
            elapsed_ms = ((finished or time.perf_counter()) - started) * 1000
            try:
                # Record after sending the response; a telemetry outage cannot lose a payment.
                async with asyncio.timeout(0.25):
                    await observe(
                        scope["app"].state.resources.redis,
                        int(time.time()) // 60,
                        status,
                        elapsed_ms,
                    )
            except (RedisError, TimeoutError):
                pass


def install_technical_metrics(app: FastAPI) -> None:
    app.add_middleware(TransferHTTPMetrics)

    @app.get("/mobile/v1/admin/metrics", response_model=TransferMetrics)
    async def metrics(request: Request, principal: IdentityDep) -> TransferMetrics:
        if principal.role != "platform_admin":
            raise HTTPException(403, "platform_admin_required")
        try:
            async with asyncio.timeout(2):
                return await snapshot(request.app.state.resources.redis, datetime.now(UTC))
        except (RedisError, TimeoutError) as exc:
            raise HTTPException(503, "metrics_unavailable") from exc

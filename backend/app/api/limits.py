"""Bound request buffering and service traffic before JSON parsing or database work.

This is a single-process service quota, not customer identity or a distributed WAF.
Never trust forwarded IP headers here: only the actual ASGI peer identifies a bucket.
"""

import asyncio
import math
import time
from collections import OrderedDict
from dataclasses import dataclass

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


@dataclass(slots=True)
class Bucket:
    tokens: float
    updated: float


class RequestLimits:
    def __init__(
        self,
        app: ASGIApp,
        *,
        prefix: str = "/api/v1",
        max_bytes: int = 16_384,
        per_minute: int = 120,
        body_timeout: float = 10.0,
    ) -> None:
        self.app = app
        self.prefix = prefix.rstrip("/") + "/"
        self.max_bytes = max_bytes
        self.per_minute = per_minute
        self.body_timeout = body_timeout
        self.buckets: OrderedDict[str, Bucket] = OrderedDict()

    def admit(self, peer: str) -> int:
        """Return retry seconds, or zero. No await occurs while updating the bucket."""
        now = time.monotonic()
        bucket = self.buckets.pop(peer, Bucket(float(self.per_minute), now))
        bucket.tokens = min(
            float(self.per_minute),
            bucket.tokens + max(0.0, now - bucket.updated) * self.per_minute / 60,
        )
        bucket.updated = now
        self.buckets[peer] = bucket
        while len(self.buckets) > 2048:
            self.buckets.popitem(last=False)
        if bucket.tokens < 1:
            return max(1, math.ceil((1 - bucket.tokens) * 60 / self.per_minute))
        bucket.tokens -= 1
        return 0

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith(self.prefix):
            await self.app(scope, receive, send)
            return
        peer = str((scope.get("client") or ("unknown", 0))[0])
        retry = self.admit(peer)
        if retry:
            await JSONResponse(
                {"detail": "Service request quota exceeded"},
                429,
                headers={"Retry-After": str(retry), "Cache-Control": "no-store"},
            )(scope, receive, send)
            return

        lengths = [v for k, v in scope.get("headers", []) if k.lower() == b"content-length"]
        try:
            if len(lengths) > 1 or (lengths and not lengths[0].isdigit()):
                raise ValueError
            expected = int(lengths[0]) if lengths else None
        except ValueError:
            await JSONResponse({"detail": "Invalid Content-Length"}, 400)(scope, receive, send)
            return
        if expected is not None and expected > self.max_bytes:
            await JSONResponse({"detail": "Request body too large"}, 413)(scope, receive, send)
            return

        body = bytearray()
        try:
            async with asyncio.timeout(self.body_timeout):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    chunk = message.get("body", b"")
                    if len(body) + len(chunk) > self.max_bytes:
                        await JSONResponse({"detail": "Request body too large"}, 413)(
                            scope, receive, send
                        )
                        return
                    body.extend(chunk)
                    if not message.get("more_body", False):
                        break
        except TimeoutError:
            await JSONResponse({"detail": "Request body timed out"}, 408)(scope, receive, send)
            return
        if expected is not None and expected != len(body):
            await JSONResponse({"detail": "Content-Length mismatch"}, 400)(scope, receive, send)
            return

        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)

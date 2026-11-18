import asyncio
from collections.abc import Awaitable, Callable

import pytest
from starlette.responses import JSONResponse
from starlette.types import Message, Receive, Scope, Send

from app.api.limits import RequestLimits


async def call(
    app: RequestLimits,
    chunks: list[bytes],
    *,
    headers: list[tuple[bytes, bytes]] | None = None,
    peer: str = "test",
    path: str = "/api/v1/transfers/evaluate",
    custom_receive: Callable[[], Awaitable[Message]] | None = None,
) -> list[Message]:
    scope: Scope = {
        "type": "http",
        "method": "POST",
        "path": path,
        "headers": headers or [],
        "client": (peer, 1),
    }
    messages: list[Message] = []
    index = 0

    async def receive() -> Message:
        nonlocal index
        chunk = chunks[index] if index < len(chunks) else b""
        index += 1
        return {"type": "http.request", "body": chunk, "more_body": index < len(chunks)}

    async def send(message: Message) -> None:
        messages.append(message)

    await app(scope, custom_receive or receive, send)
    return messages


async def echo(scope: Scope, receive: Receive, send: Send) -> None:
    message = await receive()
    await JSONResponse({"bytes": len(message.get("body", b""))})(scope, receive, send)


@pytest.mark.parametrize("headers", [[], [(b"content-length", b"1000")]])
async def test_large_chunked_or_declared_bodies_are_rejected_before_app(
    headers: list[tuple[bytes, bytes]],
) -> None:
    reached = False

    async def forbidden(scope: Scope, receive: Receive, send: Send) -> None:
        nonlocal reached
        reached = True

    responses = await call(RequestLimits(forbidden, max_bytes=5), [b"123", b"456"], headers=headers)
    assert responses[0]["status"] == 413
    assert not reached


async def test_complete_body_is_replayed_and_length_lies_are_rejected() -> None:
    app = RequestLimits(echo, max_bytes=5)
    valid = await call(app, [b"12", b"345"], headers=[(b"content-length", b"5")])
    assert valid[0]["status"] == 200
    assert valid[1]["body"] == b'{"bytes":5}'
    mismatch = await call(app, [b"123"], headers=[(b"content-length", b"2")])
    assert mismatch[0]["status"] == 400
    duplicate = await call(app, [b""], headers=[(b"content-length", b"0")] * 2)
    assert duplicate[0]["status"] == 400


async def test_stalled_upload_has_a_total_deadline() -> None:
    async def receive() -> Message:
        await asyncio.sleep(1)
        return {"type": "http.request", "body": b"", "more_body": True}

    result = await call(RequestLimits(echo, body_timeout=0.01), [], custom_receive=receive)
    assert result[0]["status"] == 408


async def test_quota_cannot_be_bypassed_with_forwarded_ip_and_health_is_exempt() -> None:
    app = RequestLimits(echo, per_minute=1)
    first = await call(app, [b"{}"])
    assert first[0]["status"] == 200
    blocked = await call(app, [b"{}"], headers=[(b"x-forwarded-for", b"another-client")])
    assert blocked[0]["status"] == 429
    assert dict(blocked[0]["headers"])[b"retry-after"] == b"60"
    healthy = await call(app, [b"{}"], path="/health")
    assert healthy[0]["status"] == 200
    other = await call(app, [b"{}"], peer="other")
    assert other[0]["status"] == 200


def test_quota_memory_is_bounded() -> None:
    app = RequestLimits(echo)
    for index in range(2100):
        app.admit(f"peer-{index}")
    assert len(app.buckets) == 2048

"""Bounded, coalesced public readiness. Detailed diagnostics stay behind SOC auth."""

import asyncio
import time

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError


def install_readiness(app: FastAPI) -> None:
    lock = asyncio.Lock()
    checked_at = float("-inf")
    ready = False

    @app.get("/ready", include_in_schema=False)
    async def readiness() -> JSONResponse:
        nonlocal checked_at, ready
        async with lock:
            if time.monotonic() - checked_at >= 5:
                try:
                    async with asyncio.timeout(2):
                        resources = app.state.resources
                        async with resources.session_factory() as session:
                            await session.execute(text("SELECT 1"))
                        await resources.redis.ping()
                    ready = True
                except (TimeoutError, RedisError, SQLAlchemyError, OSError):
                    ready = False
                checked_at = time.monotonic()
        return JSONResponse(
            {"status": "ready" if ready else "unavailable"},
            status_code=200 if ready else 503,
            headers={"Cache-Control": "no-store"},
        )

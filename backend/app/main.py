"""FastAPI application factory for BCC Shield."""

import asyncio
import math
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.security import require_soc_access, require_transfer_access
from app.api.v1 import soc, transfers
from app.core.config import Settings, get_settings
from app.core.resources import Resources
from app.ml.features import Features


def create_app(settings: Settings | None = None, resources: Resources | None = None) -> FastAPI:
    """Build the app. Tests inject ``resources`` (SQLite + fakeredis); prod builds its own."""
    cfg = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        res = resources or Resources.build(cfg)
        await res.start()
        app.state.resources = res
        try:
            yield
        finally:
            await res.close()

    app = FastAPI(
        title=cfg.app_name,
        version="0.1.0",
        description="Real-time antifraud, drop-network detection and adaptive cooling-off "
        "for Bank CenterCredit transfers (kk/ru explainability).",
        lifespan=lifespan,
        docs_url=None if cfg.environment == "pilot" else "/docs",
        redoc_url=None if cfg.environment == "pilot" else "/redoc",
        openapi_url=None if cfg.environment == "pilot" else "/openapi.json",
    )
    app.state.settings = cfg
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-BCC-API-Key", "X-BCC-SOC-Key"],
    )

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": cfg.app_name}

    @app.get("/ready", tags=["meta"], dependencies=[Depends(require_soc_access)])
    async def ready(request: Request) -> dict[str, str]:
        try:
            res: Resources = request.app.state.resources
            async with asyncio.timeout(2):
                async with res.session_factory() as session:
                    await session.execute(text("SELECT 1"))
                if not await res.redis.ping():
                    raise RuntimeError("Redis unavailable")
                await res.engine.flush_settlements()
                prediction = res.engine.model.score(Features())
                if not math.isfinite(prediction.score) or not 0 <= prediction.score <= 100:
                    raise RuntimeError("Invalid model result")
        except Exception as exc:
            # Never leak connection URLs, credentials or infrastructure errors.
            raise HTTPException(503, "Service dependencies are not ready") from exc
        return {"status": "ready", "database": "ok", "redis": "ok", "model": "ok"}

    api = APIRouter(prefix=cfg.api_prefix)
    api.include_router(transfers.router, dependencies=[Depends(require_transfer_access)])
    api.include_router(soc.router, dependencies=[Depends(require_soc_access)])
    app.include_router(api)
    return app


app = create_app()

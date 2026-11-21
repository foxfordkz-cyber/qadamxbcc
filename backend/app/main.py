"""FastAPI application factory for Saq Bol."""

import asyncio
import math
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.limits import RequestLimits
from app.api.security import require_soc_access, require_transfer_access
from app.api.v1 import (
    call_check,
    external_checks,
    integrations,
    payee_check,
    returns,
    scam_guide,
    soc,
    transfers,
    trusted_contacts,
)
from app.core.config import Settings, get_settings
from app.core.resources import Resources
from app.integrations.config import get_integration_settings
from app.integrations.errors import IntegrationError
from app.ml.features import Features
from app.services.graph import GraphCapacityError
from app.services.velocity import VelocityCapacityError


def create_app(settings: Settings | None = None, resources: Resources | None = None) -> FastAPI:
    """Build the app. Tests inject ``resources`` (SQLite + fakeredis); prod builds its own."""
    cfg = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        res = resources or Resources.build(cfg)
        await res.start()
        app.state.resources = res
        async with AsyncExitStack() as stack:
            stack.push_async_callback(res.close)
            if cfg.render_telegram_test:
                from app.integrations.telegram.hosted import hosted_telegram

                await stack.enter_async_context(
                    hosted_telegram(cfg, app.state.integration_settings, res.session_factory)
                )
            yield

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

    @app.exception_handler(GraphCapacityError)
    @app.exception_handler(VelocityCapacityError)
    async def scoring_capacity_error(
        request: Request, exc: VelocityCapacityError | GraphCapacityError
    ) -> JSONResponse:
        return JSONResponse(
            {"detail": "Risk history exceeds the supported scoring capacity"},
            status_code=503,
            headers={"Retry-After": "60", "Cache-Control": "no-store"},
        )

    app.add_middleware(
        RequestLimits,
        prefix=cfg.api_prefix,
        max_bytes=cfg.max_request_bytes,
        per_minute=cfg.request_rate_limit_per_minute,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-BCC-API-Key", "X-BCC-SOC-Key"],
    )
    app.state.integration_settings = get_integration_settings()

    @app.exception_handler(IntegrationError)
    async def integration_error(request: Request, exc: IntegrationError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content={"detail": exc.code})

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
                await res.engine.ensure_consistent()
                prediction = res.engine.model.score(Features())
                numeric = [prediction.score, prediction.base_score]
                numeric.extend(
                    value
                    for contributor in prediction.contributors
                    for value in (contributor.value, contributor.contribution)
                )
                if (
                    not all(math.isfinite(value) for value in numeric)
                    or not 0 <= prediction.score <= 100
                    or not 0 <= prediction.base_score <= 100
                ):
                    raise RuntimeError("Invalid model result")
        except Exception as exc:
            # Never leak connection URLs, credentials or infrastructure errors.
            raise HTTPException(503, "Service dependencies are not ready") from exc
        return {"status": "ready", "database": "ok", "redis": "ok", "model": "ok"}

    api = APIRouter(prefix=cfg.api_prefix)
    api.include_router(transfers.router, dependencies=[Depends(require_transfer_access)])
    api.include_router(returns.router, dependencies=[Depends(require_transfer_access)])
    api.include_router(returns.soc_router, dependencies=[Depends(require_soc_access)])
    api.include_router(call_check.router, dependencies=[Depends(require_transfer_access)])
    if cfg.environment != "pilot":
        api.include_router(payee_check.router, dependencies=[Depends(require_transfer_access)])
    api.include_router(scam_guide.router, dependencies=[Depends(require_transfer_access)])
    api.include_router(soc.router, dependencies=[Depends(require_soc_access)])
    api.include_router(trusted_contacts.router)
    api.include_router(external_checks.router)
    api.include_router(integrations.router)
    app.include_router(api)
    return app


app = create_app()

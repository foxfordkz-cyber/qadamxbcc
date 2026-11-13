"""FastAPI application factory for BCC Shield."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import soc, transfers
from app.core.config import Settings, get_settings
from app.core.resources import Resources


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
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": cfg.app_name}

    api = APIRouter(prefix=cfg.api_prefix)
    api.include_router(transfers.router)
    api.include_router(soc.router)
    app.include_router(api)
    return app


app = create_app()

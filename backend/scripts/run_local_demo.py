"""Single-worker localhost demo using persistent SQLite and in-process fake Redis.

Run from backend: uv run python -m scripts.run_local_demo [--port 8000]
This executes the real rules/graph/ML pipeline, but is never a pilot deployment.
"""

import argparse
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import select

from app.core.config import Settings
from app.core.resources import Resources
from app.db.session import build_engine, build_session_factory
from app.models import Transaction
from scripts.bootstrap_demo import is_empty

BACKEND = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE = BACKEND.parent / ".local-checks" / "local-demo.db"


def require_demo_environment() -> None:
    if os.environ.get("BCC_ENVIRONMENT", "local").lower() not in {"local", "demo"}:
        raise RuntimeError("The SQLite/fakeredis runner is restricted to local/demo environments")


def prepare_database(path: Path) -> str:
    """Migrate only the dedicated SQLite database before starting the server event loop."""
    require_demo_environment()
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    url = f"sqlite+aiosqlite:///{path.as_posix()}"
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    config.attributes["configure_logger"] = False
    command.upgrade(config, "head")
    return url


def create_demo_app(database_url: str) -> FastAPI:
    require_demo_environment()
    if not database_url.startswith("sqlite+aiosqlite:///"):
        raise ValueError("The local demo runner accepts only its dedicated SQLite database")
    # Development-only dependency; Docker/pilot does not require fakeredis.
    from fakeredis import FakeAsyncRedis

    from app.main import create_app
    from scripts.seed_bcc import seed

    settings = Settings(
        _env_file=None,
        environment="demo",
        app_name="BCC Shield Local Demo (SQLite / in-process Redis)",
        database_url=database_url,
        allow_demo_overrides=True,
        api_key=None,
        soc_api_key=None,
    )
    app = create_app(settings)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        db_engine = build_engine(database_url)
        factory = build_session_factory(db_engine)
        redis = FakeAsyncRedis()
        try:
            empty = await is_empty(factory)
            if empty:
                report = await seed(
                    factory, redis, n_background_accounts=40, n_background_transactions=120
                )
                print(
                    f"Local demo: seeded {report.accounts} synthetic accounts and "
                    f"{report.transactions} transfers in dedicated SQLite.",
                    flush=True,
                )
            else:
                print("Local demo: preserving existing SQLite data; seed skipped.", flush=True)
            resources = Resources.build(settings, session_factory=factory, redis=redis)
            await resources.start()
            if not empty:
                # fakeredis is ephemeral. Rebuild recent attempt velocity separately
                # from committed money so restart preserves all three demo scenarios.
                async with factory() as session:
                    recent = await session.scalars(
                        select(Transaction)
                        .where(Transaction.created_at >= datetime.now(UTC) - timedelta(hours=24))
                        .order_by(Transaction.created_at)
                    )
                    for tx in recent:
                        await resources.engine.velocity.record_and_snapshot(
                            tx_id=str(tx.id),
                            sender_id=str(tx.sender_id),
                            recipient_id=str(tx.recipient_id),
                            amount=float(tx.amount),
                            ts=tx.created_at.timestamp(),
                        )
            application.state.resources = resources
            print("Local demo ready: one worker, real ML/graph, synthetic data only.", flush=True)
            yield
        finally:
            await redis.aclose()
            await db_engine.dispose()

    app.router.lifespan_context = lifespan
    return app


def main() -> None:
    require_demo_environment()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    url = prepare_database(DEFAULT_DATABASE)
    application = create_demo_app(url)
    import uvicorn

    uvicorn.run(application, host="127.0.0.1", port=args.port, workers=1)


if __name__ == "__main__":
    main()

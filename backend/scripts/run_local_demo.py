"""Single-worker localhost demo using persistent SQLite and in-process fake Redis.

Run from backend: uv run python -m scripts.run_local_demo [--port 8000]
This executes the real rules/graph/ML pipeline, but is never a pilot deployment.
"""

import argparse
import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI

from app.core.config import Settings
from app.core.resources import Resources
from app.db.session import build_engine, build_session_factory
from scripts.bootstrap_demo import is_empty

BACKEND = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE = BACKEND.parent / ".local-checks" / "local-demo.db"
DEMO_STATE = DEFAULT_DATABASE.parent


def require_demo_environment() -> None:
    if os.environ.get("BCC_ENVIRONMENT", "local").lower() not in {"local", "demo"}:
        raise RuntimeError("The SQLite/fakeredis runner is restricted to local/demo environments")


def select_demo_database(path: Path, *, fresh: bool = False, state_root: Path = DEMO_STATE) -> Path:
    """CLI database targets stay in the demo state directory; fresh never overwrites."""
    require_demo_environment()
    root = state_root.resolve()
    selected = path.resolve()
    if not selected.is_relative_to(root) or selected.suffix.lower() != ".db":
        raise ValueError("Demo databases must be .db files inside the demo state directory")
    selected.parent.mkdir(parents=True, exist_ok=True)
    if fresh:
        # Exclusive creation is the no-reset promise, including simultaneous launchers.
        with selected.open("xb"):
            pass
    return selected


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


def create_demo_app(database_url: str, *, soc_demo: bool = False) -> FastAPI:
    require_demo_environment()
    if not database_url.startswith("sqlite+aiosqlite:///"):
        raise ValueError("The local demo runner accepts only its dedicated SQLite database")
    # Development-only dependency; Docker/pilot does not require fakeredis.
    from fakeredis import FakeAsyncRedis

    from app.integrations.config import IntegrationSettings
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
    if soc_demo:
        from scripts.local_soc_demo import require_offline_soc

        integration_config = IntegrationSettings(_env_file=None)
        require_offline_soc(integration_config)
        app.state.integration_settings = integration_config
    else:
        # A credential or .env left by a separate integration rehearsal must not
        # silently enable integrations in the ordinary local demo.
        app.state.integration_settings = IntegrationSettings(_env_file=None, enabled=False)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        db_engine = build_engine(database_url)
        factory = build_session_factory(db_engine)
        redis = FakeAsyncRedis()
        worker: asyncio.Task[None] | None = None
        try:
            empty = await is_empty(factory)
            if soc_demo and not empty:
                raise RuntimeError("SOC rehearsal requires a fresh isolated database")
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
            application.state.resources = resources
            if soc_demo:
                from scripts.local_soc_demo import local_soc_worker, seed_soc_rehearsal

                worker = asyncio.create_task(local_soc_worker(resources, integration_config))
                application.state.soc_rehearsal = await seed_soc_rehearsal(
                    application, integration_config
                )
                print(
                    "Local SOC demo: two linked cases, fake contact and MOCK evidence ready.",
                    flush=True,
                )
            print("Local demo ready: one worker, real ML/graph, synthetic data only.", flush=True)
            yield
        finally:
            if worker is not None:
                worker.cancel()
                with suppress(asyncio.CancelledError):
                    await worker
            await redis.aclose()
            await db_engine.dispose()

    app.router.lifespan_context = lifespan
    return app


def main() -> None:
    require_demo_environment()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--fresh", action="store_true", help="Refuse an existing database file")
    parser.add_argument(
        "--soc-demo",
        action="store_true",
        help="Fake SOC integrations on a fresh isolated database only",
    )
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    if args.soc_demo and not args.fresh:
        parser.error("--soc-demo requires --fresh")
    try:
        selected = select_demo_database(args.database, fresh=args.fresh)
    except (ValueError, FileExistsError) as exc:
        parser.error(str(exc))
    url = prepare_database(selected)
    application = create_demo_app(url, soc_demo=args.soc_demo)
    import uvicorn

    uvicorn.run(application, host="127.0.0.1", port=args.port, workers=1)


if __name__ == "__main__":
    main()

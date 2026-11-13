"""The hand-written Alembic migration must round-trip and match the ORM metadata."""

from pathlib import Path
from typing import Any

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app.db.base import Base

BACKEND = Path(__file__).resolve().parents[1]


def _config(url: str) -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    cfg.attributes["configure_logger"] = False
    return cfg


def test_upgrade_matches_models_and_downgrades(tmp_path: Path) -> None:
    db_file = tmp_path / "migrate.db"
    cfg = _config(f"sqlite+aiosqlite:///{db_file.as_posix()}")

    command.upgrade(cfg, "head")

    sync_engine = create_engine(f"sqlite:///{db_file.as_posix()}")
    try:
        with sync_engine.connect() as conn:
            ctx = MigrationContext.configure(conn, opts={"compare_type": False})
            diff: list[Any] = compare_metadata(ctx, Base.metadata)
        assert diff == [], f"migration drift: {diff}"

        command.downgrade(cfg, "base")
        with sync_engine.connect() as conn:
            tables = set(inspect(conn).get_table_names()) - {"alembic_version"}
        assert tables == set()
    finally:
        sync_engine.dispose()

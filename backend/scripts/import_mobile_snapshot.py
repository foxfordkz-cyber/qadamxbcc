"""Rehearse a read-only mobile SQLite snapshot import into an empty, migrated local PostgreSQL."""

import argparse
import asyncio
import hashlib
import json
import os
import sqlite3
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from alembic.script import ScriptDirectory
from sqlalchemy import JSON, Connection, Table, create_engine, inspect, null, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

import app.models  # noqa: F401
from app.db.base import Base

MIGRATIONS = Path(__file__).resolve().parents[1] / "alembic"


class SnapshotError(ValueError):
    """An operator message that does not contain any source data."""


def signature(row: Mapping[str, Any]) -> bytes:
    payload = json.dumps(dict(row), default=str, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode()).digest()


def columns(conn: Connection) -> dict[str, set[str]]:
    inspector = inspect(conn)
    return {
        name: {c["name"] for c in inspector.get_columns(name)}
        for name in inspector.get_table_names()
        if name != "alembic_version"
    }


def records(table: Table) -> Any:
    # Keep SQL NULL distinguishable from JSON null during verification.
    extra = [c.is_(None).label("_sql_null_" + c.name) for c in table.c if isinstance(c.type, JSON)]
    # All current primary keys are UUIDs or UUID/integer pairs. Sorting by the
    # complete key produces the same order on SQLite and PostgreSQL.
    return select(table, *extra).order_by(*table.primary_key.columns)


async def transfer(snapshot: Path, destination_url: str, *, dry_run: bool = False) -> int:
    url = make_url(destination_url)
    if (
        url.drivername != "postgresql+asyncpg"
        or url.host not in {"localhost", "127.0.0.1", "::1"}
        or url.database != "qadam_import_rehearsal"
        or url.query
    ):
        raise SnapshotError("Use a local empty database named qadam_import_rehearsal")
    if not await asyncio.to_thread(snapshot.is_file):
        raise SnapshotError("Snapshot file is missing")

    def read_only() -> sqlite3.Connection:
        return sqlite3.connect(snapshot.resolve().as_uri() + "?mode=ro", uri=True)

    tables = Base.metadata.sorted_tables
    heads = set(ScriptDirectory(str(MIGRATIONS)).get_heads())
    expected = {t.name: set(t.c.keys()) for t in tables}
    src = create_engine("sqlite://", creator=read_only, hide_parameters=True)
    dst = create_async_engine(url, hide_parameters=True)
    try:
        with src.connect() as source:
            source.exec_driver_sql("BEGIN")
            if source.exec_driver_sql("PRAGMA integrity_check").scalars().all() != ["ok"]:
                raise SnapshotError("Source integrity check failed")
            if source.exec_driver_sql("PRAGMA foreign_key_check").first():
                raise SnapshotError("Source has a broken relationship")
            if columns(source) != expected:
                raise SnapshotError("Snapshot schema differs from this release")
            if inspect(source).has_table("alembic_version") and (
                set(source.exec_driver_sql("SELECT version_num FROM alembic_version").scalars())
                != heads
            ):
                raise SnapshotError("Snapshot Alembic revision differs from this release")
            async with dst.begin() as target:
                await target.exec_driver_sql("SET LOCAL search_path = public, pg_catalog, pg_temp")
                identity = await target.exec_driver_sql(
                    "SELECT current_database(), current_schema()"
                )
                if identity.one() != ("qadam_import_rehearsal", "public"):
                    raise SnapshotError("Unexpected target database or schema")
                if await target.run_sync(columns) != expected:
                    raise SnapshotError("Migrate the empty target to the matching schema first")
                # Lock the complete set before checking emptiness. Nothing can be added mid-import.
                quoted = ", ".join('public."' + t.name + '"' for t in tables)
                await target.exec_driver_sql(
                    "LOCK TABLE public.alembic_version, "
                    + quoted
                    + " IN ACCESS EXCLUSIVE MODE NOWAIT"
                )
                versions = await target.exec_driver_sql(
                    "SELECT version_num FROM public.alembic_version"
                )
                if set(versions.scalars()) != heads:
                    raise SnapshotError("Target Alembic revision differs from this release")
                for table in tables:
                    if (await target.execute(select(table).limit(1))).first() is not None:
                        raise SnapshotError("Target contains data")
                extra_storage = await target.scalar(
                    text("""
                    SELECT EXISTS (
                        SELECT FROM pg_catalog.pg_class c
                        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
                          AND (c.relkind IN ('S', 'm', 'f')
                               OR (n.nspname <> 'public' AND c.relkind IN ('r', 'p')))
                    )
                """)
                )
                if extra_storage:
                    raise SnapshotError("Target contains storage outside the supported schema")

                total = 0
                for table in tables:
                    stmt = records(table)
                    expected_hash = hashlib.sha256()
                    for batch in source.execute(stmt).mappings().partitions(500):
                        groups: dict[tuple[str, ...], list[dict[str, Any]]] = {}
                        for row in batch:
                            nulls = tuple(c.name for c in table.c if row.get("_sql_null_" + c.name))
                            values = {c.name: row[c.name] for c in table.c if c.name not in nulls}
                            groups.setdefault(nulls, []).append(values)
                        for nulls, entries in groups.items():
                            insert = table.insert().values({key: null() for key in nulls})
                            await target.execute(insert, entries)
                        for row in batch:
                            expected_hash.update(signature(dict(row)))
                        total += len(batch)
                    actual_hash = hashlib.sha256()
                    async with target.stream(stmt) as stored:
                        async for row in stored.mappings():
                            actual_hash.update(signature(dict(row)))
                    if actual_hash.digest() != expected_hash.digest():
                        raise SnapshotError("Row comparison failed for " + table.name)
                if dry_run:
                    await target.rollback()
                return total
    finally:
        src.dispose()
        await dst.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--dry-run", action="store_true", help="Verify all writes then roll back")
    args = parser.parse_args()
    try:
        count = asyncio.run(
            transfer(args.snapshot, os.environ["QADAM_IMPORT_DATABASE_URL"], dry_run=args.dry_run)
        )
    except Exception as exc:
        # Engine exceptions may include statements or records. Only disclose controlled messages.
        message = str(exc) if isinstance(exc, SnapshotError) else type(exc).__name__
        raise SystemExit(message) from None
    action = "rolled back" if args.dry_run else "committed"
    print(f"Verified and {action} {count} rows in the local rehearsal database.")

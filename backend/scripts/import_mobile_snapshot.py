"""Rehearse a read-only mobile SQLite snapshot import into an empty, migrated local PostgreSQL."""

import argparse
import asyncio
import hashlib
import json
import os
import sqlite3
from collections import Counter
from collections.abc import Mapping
from contextlib import closing
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, Connection, Table, create_engine, inspect, null, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

import app.models  # noqa: F401
from app.db.base import Base


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
    return select(table, *extra)


async def transfer(snapshot: Path, destination_url: str) -> int:
    url = make_url(destination_url)
    if (
        url.drivername != "postgresql+asyncpg"
        or url.host not in {"localhost", "127.0.0.1", "::1"}
        or url.database != "qadam_import_rehearsal"
    ):
        raise SnapshotError("Use a local empty database named qadam_import_rehearsal")
    if not await asyncio.to_thread(snapshot.is_file):
        raise SnapshotError("Snapshot file is missing")

    def read_only() -> sqlite3.Connection:
        return sqlite3.connect(snapshot.resolve().as_uri() + "?mode=ro", uri=True)

    with closing(read_only()) as check:
        if check.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise SnapshotError("Source integrity check failed")
        if check.execute("PRAGMA foreign_key_check").fetchone():
            raise SnapshotError("Source has a broken relationship")

    tables = Base.metadata.sorted_tables
    expected = {t.name: set(t.c.keys()) for t in tables}
    src = create_engine("sqlite://", creator=read_only, hide_parameters=True)
    dst = create_async_engine(url, hide_parameters=True)
    try:
        with src.connect() as source:
            source.exec_driver_sql("BEGIN")
            if columns(source) != expected:
                raise SnapshotError("Snapshot schema differs from this release")
            async with dst.begin() as target:
                if await target.run_sync(columns) != expected:
                    raise SnapshotError("Migrate the empty target to the matching schema first")
                # Lock the complete set before checking emptiness. Nothing can be added mid-import.
                quoted = ", ".join('public."' + t.name + '"' for t in tables)
                await target.exec_driver_sql(
                    "LOCK TABLE " + quoted + " IN ACCESS EXCLUSIVE MODE NOWAIT"
                )
                for table in tables:
                    if (await target.execute(select(table).limit(1))).first() is not None:
                        raise SnapshotError("Target contains data")
                sequences = await target.scalar(
                    text("SELECT count(*) FROM pg_sequences WHERE schemaname='public'")
                )
                if sequences:
                    raise SnapshotError("Target sequence counters require separate verification")

                total = 0
                for table in tables:
                    stmt = records(table)
                    fingerprints: Counter[bytes] = Counter()
                    for batch in source.execute(stmt).mappings().partitions(500):
                        groups: dict[tuple[str, ...], list[dict[str, Any]]] = {}
                        for row in batch:
                            nulls = tuple(c.name for c in table.c if row.get("_sql_null_" + c.name))
                            values = {c.name: row[c.name] for c in table.c if c.name not in nulls}
                            groups.setdefault(nulls, []).append(values)
                        for nulls, entries in groups.items():
                            insert = table.insert().values({key: null() for key in nulls})
                            await target.execute(insert, entries)
                        fingerprints.update(signature(dict(row)) for row in batch)
                        total += len(batch)
                    actual = (await target.execute(stmt)).mappings()
                    if Counter(signature(dict(row)) for row in actual) != fingerprints:
                        raise SnapshotError("Row comparison failed for " + table.name)
                return total
    finally:
        src.dispose()
        await dst.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    args = parser.parse_args()
    try:
        count = asyncio.run(transfer(args.snapshot, os.environ["QADAM_IMPORT_DATABASE_URL"]))
    except Exception as exc:
        # Engine exceptions may include statements or records. Only disclose controlled messages.
        message = str(exc) if isinstance(exc, SnapshotError) else type(exc).__name__
        raise SystemExit(message) from None
    print(f"Verified and committed {count} rows to the local rehearsal database.")

"""Copy a consistent SQLite snapshot into a NEW owner-protected file. Never overwrite a database."""

import argparse
import hashlib
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory


def fingerprint(db: sqlite3.Connection) -> bytes:
    """Hash typed row representations in canonical order, including schema and duplicate rows."""
    schema = db.execute("SELECT type,name,sql FROM sqlite_schema ORDER BY type,name").fetchall()
    state = hashlib.sha256(repr(schema).encode())
    for kind, name, _ in schema:
        if kind != "table":
            continue
        quoted = '"' + name.replace('"', '""') + '"'
        hashes = sorted(
            hashlib.sha256(repr(tuple(row)).encode()).digest()
            for row in db.execute("SELECT * FROM " + quoted)
        )
        state.update(repr((name, len(hashes))).encode())
        for row_hash in hashes:
            state.update(row_hash)
    return state.digest()


def copy_verified(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise ValueError("Source database does not exist")
    with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)) as src:
        src.execute("BEGIN")
        expected = fingerprint(src)
        fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        try:
            with closing(sqlite3.connect(destination)) as out:
                src.backup(out)
                if out.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                    raise ValueError("Database integrity check failed")
                if (
                    out.execute("PRAGMA foreign_key_check").fetchone()
                    or fingerprint(out) != expected
                ):
                    raise ValueError("Database data or relationships differ")
        except BaseException:
            destination.unlink(missing_ok=True)
            raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("new_snapshot", type=Path)
    args = parser.parse_args()
    copy_verified(args.source, args.new_snapshot)
    with TemporaryDirectory(dir=args.new_snapshot.parent) as scratch:
        copy_verified(args.new_snapshot, Path(scratch) / "restored.sqlite")
    print("Snapshot and independent restore passed schema, all-row and foreign-key checks.")

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from scripts.backup_mobile_sqlite import copy_verified, fingerprint


def test_wal_snapshot_restores_all_rows_before_and_after_reopen(tmp_path: Path) -> None:
    live = tmp_path / "live.sqlite"
    snapshot = tmp_path / "snapshot.sqlite"
    restored = tmp_path / "restored.sqlite"
    with closing(sqlite3.connect(live)) as app:
        app.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE accounts(id PRIMARY KEY, balance INTEGER);
            CREATE TABLE ledger(request_id TEXT UNIQUE,
                sender REFERENCES accounts(id), amount INTEGER);
            INSERT INTO accounts VALUES ('synthetic-owner', 75000);
            INSERT INTO ledger VALUES ('first', 'synthetic-owner', 25000);
        """)
        expected = fingerprint(app)
        copy_verified(live, snapshot)
        app.execute("UPDATE accounts SET balance = 70000")
        app.commit()
    copy_verified(snapshot, restored)
    for _ in range(2):
        with closing(sqlite3.connect(restored)) as restarted:
            assert fingerprint(restarted) == expected
            with pytest.raises(sqlite3.IntegrityError):
                restarted.execute("INSERT INTO ledger VALUES ('first', 'synthetic-owner', 25000)")
    with pytest.raises(FileExistsError):
        copy_verified(snapshot, restored)

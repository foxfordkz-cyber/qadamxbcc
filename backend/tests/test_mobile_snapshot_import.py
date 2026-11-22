"""Use synthetic SQLite inputs and a freshly migrated isolated PostgreSQL in restore CI."""

import hashlib
import os
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import JSON, create_engine, func, insert, null, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.base import Base
from app.models import AbandonedRequest, Account, Transaction, TransactionStatus
from scripts.import_mobile_snapshot import SnapshotError, transfer


@pytest.mark.parametrize("suffix", ["/other", "/qadam_import_rehearsal?application_name=custom"])
async def test_ambiguous_or_wrong_destination_rejected_without_connecting(
    tmp_path: Path, suffix: str
) -> None:
    with pytest.raises(SnapshotError, match="local empty database"):
        await transfer(tmp_path / "absent", "postgresql+asyncpg://127.0.0.1" + suffix)


async def test_source_revision_rejected_before_connecting(tmp_path: Path) -> None:
    path = tmp_path / "old.db"
    sqlite = create_engine("sqlite:///" + path.as_posix())
    with sqlite.begin() as conn:
        Base.metadata.create_all(conn)
        conn.exec_driver_sql("CREATE TABLE alembic_version(version_num TEXT)")
        conn.exec_driver_sql("INSERT INTO alembic_version VALUES ('old')")
    sqlite.dispose()
    with pytest.raises(SnapshotError, match="Snapshot Alembic revision"):
        await transfer(path, "postgresql+asyncpg://127.0.0.1:1/qadam_import_rehearsal")


DATE = datetime(2026, 11, 21, 10, 45, 1, 135790, tzinfo=UTC)


@pytest.fixture
def snapshot(tmp_path: Path) -> Path:
    path = tmp_path / "wallet.db"
    source = create_engine("sqlite:///" + path.as_posix())
    account = UUID(int=12)
    recipient = UUID(int=13)
    with source.begin() as conn:
        Base.metadata.create_all(conn)
        conn.execute(insert(AbandonedRequest).values(request_id=UUID(int=8), created_at=DATE))
        conn.execute(
            insert(Account).values(
                id=account,
                iin="000000000012",
                phone="+77000000012",
                iban="KZ000000000000000012",
                full_name="Сынақ Әлия",
                device_id="x" * 65,
                avg_tx_amount=Decimal("42501.75"),
                created_at=DATE,
            )
        )
        conn.execute(
            insert(Account).values(
                id=recipient,
                iin="000000000013",
                phone="+77000000013",
                iban="KZ000000000000000013",
                full_name="Сынақ Алмас",
                device_id="test-recipient",
            )
        )
        for index, answers in enumerate((null(), JSON.NULL)):
            conn.execute(
                insert(Transaction).values(
                    id=UUID(int=30 + index),
                    request_id=UUID(int=50 + index),
                    sender_id=account,
                    recipient_id=recipient,
                    amount=Decimal("171.25"),
                    device_id="test-payer",
                    status=TransactionStatus.APPROVED,
                    evaluation_snapshot={"kk": "Қабылданды", "flags": [True, None, 3]},
                    verification_answers=answers,
                )
            )
    source.dispose()
    return path


def test_sqlite_source_distinguishes_json_null_from_sql_null(snapshot: Path) -> None:
    source = create_engine("sqlite:///" + snapshot.as_posix())
    try:
        with source.connect() as conn:
            assert conn.scalars(
                select(Transaction.verification_answers.is_(None)).order_by(Transaction.id)
            ).all() == [True, False]
            assert conn.exec_driver_sql("PRAGMA foreign_key_check").first() is None
    finally:
        source.dispose()


async def test_postgres_snapshot_atomicity(snapshot: Path) -> None:
    url = os.getenv("QADAM_TEST_IMPORT_URL")
    if not url:
        pytest.skip("restore-rehearsal provisions a dedicated PostgreSQL target")
    source = create_engine("sqlite:///" + snapshot.as_posix())
    path, account, recipient = snapshot, UUID(int=12), UUID(int=13)
    # PostgreSQL enforces varchar(64) on the second table, after abandoned_requests
    # was copied. SQLite accepted the same longer text on the source.
    target = create_async_engine(url)
    try:
        with pytest.raises(DBAPIError):
            await transfer(path, url)
        async with target.connect() as conn:
            assert await conn.scalar(select(func.count()).select_from(AbandonedRequest)) == 0
        with source.begin() as conn:
            conn.execute(text("UPDATE accounts SET device_id='test-device'"))
        original = hashlib.sha256(path.read_bytes()).digest()
        assert await transfer(path, url, dry_run=True) == 5
        async with target.connect() as conn:
            assert await conn.scalar(select(func.count()).select_from(AbandonedRequest)) == 0
            assert await conn.scalar(select(func.count()).select_from(Account)) == 0
        assert await transfer(path, url) == 5
        with pytest.raises(SnapshotError, match="Target contains data"):
            await transfer(path, url)
        async with target.connect() as conn:
            stmt = select(Account.id, Account.created_at, Account.avg_tx_amount, Account.full_name)
            assert (await conn.execute(stmt.where(Account.id == account))).one() == (
                account,
                DATE,
                Decimal("42501.75"),
                "Сынақ Әлия",
            )
            assert await conn.scalar(select(AbandonedRequest.request_id)) == UUID(int=8)
            values = await conn.execute(
                select(
                    Transaction.request_id,
                    Transaction.verification_answers.is_(None),
                    Transaction.evaluation_snapshot,
                    Transaction.recipient_id,
                ).order_by(Transaction.id)
            )
            rows = values.all()
            assert len(rows) == 2
            for index, row in enumerate(rows):
                assert row == (
                    UUID(int=50 + index),
                    index == 0,
                    {"kk": "Қабылданды", "flags": [True, None, 3]},
                    recipient,
                )
        assert hashlib.sha256(path.read_bytes()).digest() == original
    finally:
        source.dispose()
        await target.dispose()

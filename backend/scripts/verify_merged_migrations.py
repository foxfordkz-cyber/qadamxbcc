"""Rehearse both published upgrade paths in an EMPTY, explicitly named test database.

This command drops only the synthetic rows it creates by downgrading that test database.
It refuses an existing schema, including an already migrated demo or test database.
"""

import asyncio
import os
import uuid
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.kz import make_kz_iban
from app.db.base import utcnow
from app.integrations.models import TrustedContact
from app.models import Account

ACCOUNT = uuid.UUID("00000000-0000-4000-8000-000000000901")
CONTACT = uuid.UUID("00000000-0000-4000-8000-000000000902")
HEAD = "0009_mobile_protection"


async def require_empty(url: str) -> None:
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            tables = await connection.run_sync(lambda conn: inspect(conn).get_table_names())
            if tables:
                raise RuntimeError("migration rehearsal requires an empty disposable database")
    finally:
        await engine.dispose()


async def sentinel(url: str, *, insert: bool, contact: bool) -> None:
    engine = create_async_engine(url)
    try:
        async with async_sessionmaker(engine)() as session:
            if insert:
                session.add(
                    Account(
                        id=ACCOUNT,
                        iin="000000000901",
                        iban=make_kz_iban("0000000000901"),
                        phone="+77000000901",
                        full_name="Synthetic migration sentinel",
                        device_id="synthetic-migration",
                    )
                )
                await session.flush()
                if contact:
                    session.add(
                        TrustedContact(
                            id=CONTACT,
                            owner_id=ACCOUNT,
                            invitation_expires_at=utcnow(),
                            language="kk",
                            state="CONTACT_REVOKED",
                            notifications_enabled=False,
                        )
                    )
                await session.commit()
            else:
                account = await session.get(Account, ACCOUNT)
                assert account is not None
                assert account.full_name == "Synthetic migration sentinel"
                if contact:
                    row = await session.get(TrustedContact, CONTACT)
                    assert row is not None
                    assert row.state == "CONTACT_REVOKED"
                    assert not row.notifications_enabled
                    assert row.telegram_chat_id is None
    finally:
        await engine.dispose()


def verify() -> None:
    url = os.environ["BCC_TEST_DATABASE_URL"]
    database = Path(make_url(url).database or "").name
    if not database.startswith("bcc_integration_test"):
        raise RuntimeError("migration rehearsal requires bcc_integration_test database")
    asyncio.run(require_empty(url))
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    assert ScriptDirectory.from_config(config).get_heads() == [HEAD]
    for previous in ("0003", "0007_guardian_cases"):
        has_contact = previous == "0007_guardian_cases"
        command.upgrade(config, previous)
        asyncio.run(sentinel(url, insert=True, contact=has_contact))
        command.upgrade(config, "head")
        command.check(config)
        asyncio.run(sentinel(url, insert=False, contact=has_contact))
        # Existing paths are still independently addressable after removing the merge node.
        command.downgrade(config, previous)
        asyncio.run(sentinel(url, insert=False, contact=has_contact))
        command.upgrade(config, "head")
        command.check(config)
        asyncio.run(sentinel(url, insert=False, contact=has_contact))
        command.downgrade(config, "base")
        print(f"PASS: {previous} -> merged head -> {previous} -> head; synthetic rows preserved")


if __name__ == "__main__":
    verify()

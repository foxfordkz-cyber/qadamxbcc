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
from sqlalchemy import Column, MetaData, Table, Uuid, inspect, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.kz import make_kz_iban
from app.db.base import utcnow
from app.integrations.models import TrustedContact
from app.mobile_gateway.protection_models import FamilyShield
from app.models import Account, RecipientFlagAudit

ACCOUNT = uuid.UUID("00000000-0000-4000-8000-000000000901")
CONTACT = uuid.UUID("00000000-0000-4000-8000-000000000902")
HEAD = "0014_family_approval"


async def require_empty(url: str) -> None:
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            tables = await connection.run_sync(lambda conn: inspect(conn).get_table_names())
            if tables:
                raise RuntimeError("migration rehearsal requires an empty disposable database")
    finally:
        await engine.dispose()


async def sentinel(url: str, *, insert: bool, contact: bool, mobile: bool = False) -> None:
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            accounts = await connection.run_sync(
                lambda conn: Table(
                    "accounts",
                    MetaData(),
                    Column("id", Uuid(), primary_key=True),
                    autoload_with=conn,
                )
            )
        async with async_sessionmaker(engine)() as session:
            if insert:
                # Reflect the historical schema: current ORM defaults include
                # columns that do not exist at the two published pre-merge heads.
                await session.execute(
                    accounts.insert().values(
                        id=ACCOUNT,
                        iin="000000000901",
                        iban=make_kz_iban("0000000000901"),
                        phone="+77000000901",
                        full_name="Synthetic migration sentinel",
                        device_id="synthetic-migration",
                        avg_tx_amount=0,
                        is_flagged=True,
                        created_at=utcnow(),
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
                if mobile:
                    session.add(FamilyShield(owner_id=ACCOUNT))
                await session.commit()
            else:
                account = (
                    await session.execute(
                        select(accounts.c.full_name, accounts.c.is_flagged).where(
                            accounts.c.id == ACCOUNT
                        )
                    )
                ).one()
                assert account.full_name == "Synthetic migration sentinel"
                assert account.is_flagged
                if mobile:
                    family = await session.get(FamilyShield, ACCOUNT)
                    assert family is not None
                    assert family.disable_at is None
                if contact:
                    row = await session.get(TrustedContact, CONTACT)
                    assert row is not None
                    assert row.state == "CONTACT_REVOKED"
                    assert not row.notifications_enabled
                    assert row.telegram_chat_id is None
    finally:
        await engine.dispose()


async def flag_audit_sentinel(url: str, *, already_present: bool = False) -> None:
    engine = create_async_engine(url)
    try:
        factory = async_sessionmaker(engine)
        if not already_present:
            await insert_flag_audit(factory)
        async with factory() as session:
            audit = await session.get(RecipientFlagAudit, CONTACT)
            assert audit is not None
            assert audit.flagged
            assert audit.actor == "migration_rehearsal"
            account = await session.get(Account, ACCOUNT)
            assert account is not None
            assert account.flag_version == audit.version
            assert account.flag_updated_at == audit.created_at
    finally:
        await engine.dispose()


async def insert_flag_audit(factory: async_sessionmaker[AsyncSession]) -> None:
    async with factory() as session:
        account = await session.get(Account, ACCOUNT)
        assert account is not None
        assert account.flag_version == 0
        assert account.flag_updated_at is None
        stamp = utcnow()
        account.flag_version = 1
        account.flag_updated_at = stamp
        session.add(
            RecipientFlagAudit(
                id=CONTACT,
                account_id=ACCOUNT,
                request_id=CONTACT,
                request_hash="a" * 64,
                previous_flagged=True,
                flagged=True,
                version=1,
                actor="migration_rehearsal",
                note="Synthetic existing flag preserved",
                created_at=stamp,
            )
        )
        await session.commit()


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
    for previous in ("0003", "0007_guardian_cases", "0009_mobile_protection", "0011_temporal_flow"):
        has_contact = previous != "0003"
        command.upgrade(config, previous)
        legacy = {"contact": has_contact, "mobile": previous == "0009_mobile_protection"}
        asyncio.run(sentinel(url, insert=True, **legacy))
        command.upgrade(config, "head")
        command.check(config)
        asyncio.run(sentinel(url, insert=False, **legacy))
        asyncio.run(flag_audit_sentinel(url))
        # Existing paths are still independently addressable after removing the merge node.
        command.downgrade(config, previous)
        asyncio.run(sentinel(url, insert=False, **legacy))
        command.upgrade(config, "head")
        command.check(config)
        asyncio.run(sentinel(url, insert=False, **legacy))
        # Downgrading a merge to one of its direct parents keeps the other parent applied.
        previous_is_parent = previous in {"0009_mobile_protection", "0011_temporal_flow"}
        asyncio.run(flag_audit_sentinel(url, already_present=previous_is_parent))
        command.downgrade(config, "base")
        print(f"PASS: {previous} -> merged head -> {previous} -> head; synthetic rows preserved")


if __name__ == "__main__":
    verify()

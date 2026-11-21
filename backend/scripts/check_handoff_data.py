"""Exercise the importer against the dedicated handoff database only."""

import asyncio
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select, text

from app.db.session import build_engine, build_session_factory
from app.integrations.cases.models import CaseEvent, FraudCase
from app.integrations.models import ContactNotification, GuardianReport
from app.mobile_gateway.demo_catalog import key
from app.mobile_gateway.wallet import balance
from app.models import Account, Transaction
from scripts.handoff_data import main, target_database


async def verify() -> None:
    engine = build_engine(target_database())
    factory = build_session_factory(engine)
    try:
        async with factory() as db:
            users = list(await db.scalars(select(Account.id)))
            original: dict[UUID, str] = dict(
                (
                    await db.execute(text("SELECT id, md5(to_jsonb(t)::text) FROM transactions t"))
                ).all()
            )
            balances = {uid: Decimal(await balance(db, uid)) for uid in users}
            first = await db.get(Transaction, key("out/0"))
            queue = list(await db.scalars(select(ContactNotification.id)))
        await main(False)
        async with factory() as db:
            assert set(await db.scalars(select(Transaction.id))) == set(original)
            assert set(await db.scalars(select(ContactNotification.id))) == set(queue)
        await main(True)
        async with factory() as db:
            current: dict[UUID, str] = dict(
                (
                    await db.execute(text("SELECT id, md5(to_jsonb(t)::text) FROM transactions t"))
                ).all()
            )
            assert len(current) == len(original) + (0 if first else 40)
            assert all(current[k] == v for k, v in original.items())
            assert all([Decimal(await balance(db, uid)) == balances[uid] for uid in users])
            assert set(await db.scalars(select(ContactNotification.id))) == set(queue)
            reports = list(
                await db.scalars(
                    select(GuardianReport).where(
                        GuardianReport.idempotency_key.in_([key(f"report/{i}") for i in range(10)])
                    )
                )
            )
            assert len(reports) == 10
            for report in reports:
                assert report.transaction_id is not None
                transaction = await db.get(Transaction, report.transaction_id)
                assert transaction is not None
                assert transaction.sender_id == report.owner_id
            cases = list(
                await db.scalars(
                    select(FraudCase).where(FraudCase.report_id.in_([r.id for r in reports]))
                )
            )
            assert len(cases) == 10
            versions = {c.id: c.version for c in cases}
            events = set(await db.scalars(select(CaseEvent.id)))
        await main(True)
        async with factory() as db:
            for case_id, version in versions.items():
                case = await db.get(FraudCase, case_id)
                assert case is not None
                assert case.version == version
            assert set(await db.scalars(select(CaseEvent.id))) == events
        print(
            f"Verified {len(original)} pre-existing ledger rows, {len(users)} balances, "
            f"{len(reports)} report links and {len(cases)} case histories; no delivery queued."
        )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(verify())

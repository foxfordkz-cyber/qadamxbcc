"""Stable IDs shared by the optional, isolated demonstration catalog and importer."""

from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.payee_check import RECIPIENTS
from app.models import Account, Transaction, TransactionStatus

PACK = "wallet-v1"


def key(name: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"qadam.example/handoff/{PACK}/{name}")


SAVED_TRANSFERS = {f"saved-{i + 1}": key(f"out/{i}") for i in range(4)}


def saved_recipients(owner_id: UUID) -> Select[Account, UUID]:
    return (
        select(Account, Transaction.id)
        .join(Transaction, Transaction.recipient_id == Account.id)
        .where(
            Transaction.id.in_(SAVED_TRANSFERS.values()),
            Transaction.sender_id == owner_id,
            Transaction.status == TransactionStatus.APPROVED,
        )
    )


async def wallet_recipients(session: AsyncSession, owner_id: UUID) -> list[dict[str, str]]:
    standard = await session.scalars(select(Account).where(Account.phone.in_(RECIPIENTS)))
    by_phone = {a.phone: {"name": a.full_name, "phone": a.phone} for a in standard}
    refs = {tx: ref for ref, tx in SAVED_TRANSFERS.items()}
    for account, tx_id in await session.execute(saved_recipients(owner_id)):
        by_phone.setdefault(
            account.phone,
            {"name": account.full_name, "phone": account.phone, "payee_ref": refs[tx_id]},
        )
    return sorted(by_phone.values(), key=lambda recipient: (recipient["name"], recipient["phone"]))


async def allowed_recipient(session: AsyncSession, owner_id: UUID, phone: object) -> bool:
    if not isinstance(phone, str):
        return False
    if phone in RECIPIENTS:
        return True
    return (
        await session.scalar(saved_recipients(owner_id).where(Account.phone == phone)) is not None
    )

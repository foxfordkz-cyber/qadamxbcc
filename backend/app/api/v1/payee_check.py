"""Read-only beneficiary check for the three published synthetic transfer recipients."""

import unicodedata
from typing import Final, Literal
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import SessionDep
from app.core.kz import BCC_BANK_CODE
from app.models import Account
from app.services.transfers import mask_name

router = APIRouter(prefix="/payee-check", tags=["transfers"])
Payee = Literal["normal", "scam", "hub"]
Bank = Literal["bcc", "other"]
Verdict = Literal["identified", "match", "close", "mismatch", "unavailable"]

# Resolve an opaque demo reference to BOTH account ID and phone. This endpoint never
# takes an arbitrary phone, IBAN or card number, even if someone calls it directly.
DIRECTORY: Final[dict[Payee, tuple[UUID, str]]] = {
    "normal": (UUID("00000000-0000-4000-8000-000000000002"), "+77010000002"),
    "scam": (UUID("00000000-0000-4000-8000-000000000003"), "+77010000003"),
    "hub": (UUID("00000000-0000-4000-8000-000000000004"), "+77010000004"),
}
RECIPIENTS = frozenset(phone for _, phone in DIRECTORY.values())


class PayeeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    recipient: Payee
    bank: Bank
    expected_name: str = Field(default="", max_length=80, repr=False)


class PayeeResult(BaseModel):
    recipient: Payee
    bank: Bank
    status: Verdict
    display_name: str | None = None
    source: Literal["synthetic_directory"] = "synthetic_directory"


def name_key(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).casefold().replace(".", " ").split())


def compare_name(expected: str, registered: str, display_name: str) -> Verdict:
    if not expected.strip():
        return "identified"
    requested = name_key(expected)
    registered_key = name_key(registered)
    if requested == registered_key:
        return "match"
    # An initial or a first name alone is partial evidence; never fuzzy-match a surname.
    if requested == name_key(display_name) or requested == registered_key.split()[0]:
        return "close"
    return "mismatch"


@router.post("", response_model=PayeeResult)
async def check_payee(body: PayeeRequest, session: SessionDep) -> PayeeResult:
    unavailable = PayeeResult(recipient=body.recipient, bank=body.bank, status="unavailable")
    if body.bank != "bcc":
        return unavailable
    account_id, phone = DIRECTORY[body.recipient]
    row = (
        await session.execute(
            select(Account.full_name, Account.iban).where(
                Account.id == account_id, Account.phone == phone
            )
        )
    ).one_or_none()
    if row is None or row.iban[4:7] != BCC_BANK_CODE or len(row.full_name.split()) < 2:
        return unavailable
    display_name = mask_name(row.full_name)
    return PayeeResult(
        recipient=body.recipient,
        bank=body.bank,
        status=compare_name(body.expected_name, row.full_name, display_name),
        display_name=display_name,
    )

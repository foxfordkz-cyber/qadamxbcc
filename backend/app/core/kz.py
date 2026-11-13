"""Kazakhstan identifier helpers: IIN (ЖСН/ИИН) checksum and KZ IBAN (ISO 13616)."""

import re

_IIN_W1 = (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)
_IIN_W2 = (3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2)
_KZ_IBAN_RE = re.compile(r"^KZ\d{2}\d{3}[0-9A-Z]{13}$")
BCC_BANK_CODE = "856"


def iin_check_digit(first11: str) -> int | None:
    """Return the IIN control digit for 11 leading digits, or None if unassignable."""
    if len(first11) != 11 or not first11.isdigit():
        raise ValueError("expected 11 digits")
    digits = [int(c) for c in first11]
    check = sum(d * w for d, w in zip(digits, _IIN_W1, strict=True)) % 11
    if check == 10:
        check = sum(d * w for d, w in zip(digits, _IIN_W2, strict=True)) % 11
        if check == 10:
            return None
    return check


def is_valid_iin(iin: str) -> bool:
    if len(iin) != 12 or not iin.isdigit():
        return False
    month, day = int(iin[2:4]), int(iin[4:6])
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return False
    return iin_check_digit(iin[:11]) == int(iin[11])


def _iban_mod97(rearranged: str) -> int:
    numeric = "".join(str(int(ch, 36)) for ch in rearranged)
    return int(numeric) % 97


def is_valid_kz_iban(iban: str) -> bool:
    iban = iban.replace(" ", "").upper()
    if not _KZ_IBAN_RE.match(iban):
        return False
    return _iban_mod97(iban[4:] + iban[:4]) == 1


def make_kz_iban(account_number: str, bank_code: str = BCC_BANK_CODE) -> str:
    """Build a checksum-valid KZ IBAN from a 13-char account number and 3-digit bank code."""
    bban = f"{bank_code}{account_number}".upper()
    if len(bban) != 16:
        raise ValueError("KZ BBAN must be 16 characters (3 bank + 13 account)")
    check = 98 - _iban_mod97(bban + "KZ00")
    return f"KZ{check:02d}{bban}"

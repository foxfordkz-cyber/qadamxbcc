"""Stable IDs shared by the optional, isolated demonstration catalog and importer."""

from uuid import NAMESPACE_URL, UUID, uuid5

PACK = "wallet-v1"


def key(name: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"qadam.example/handoff/{PACK}/{name}")

"""Credential recovery must never silently replace an existing handoff file."""

import json
from pathlib import Path

import pytest

from scripts.mobile_accounts import provision
from scripts.mobile_demo import load_access


def test_repeated_provision_preserves_all_existing_credentials(tmp_path: Path) -> None:
    directory = tmp_path / "accounts"
    provision(directory)
    before = {path.name: path.read_bytes() for path in directory.glob("*.json")}
    assert set(before) == {"client_demo.json", "admin_demo.json", "platform_demo.json"}
    provision(directory)
    assert {path.name: path.read_bytes() for path in directory.glob("*.json")} == before
    passwords = {json.loads(value)["password"] for value in before.values()}
    assert len(passwords) == 3


@pytest.mark.parametrize("existing", [b"partial-file", b'{"login":"client_demo"}'])
def test_provision_does_not_replace_incomplete_existing_handoff(
    tmp_path: Path, existing: bytes
) -> None:
    directory = tmp_path / "accounts"
    directory.mkdir()
    path = directory / "client_demo.json"
    path.write_bytes(existing)
    provision(directory)
    assert path.read_bytes() == existing


def test_gateway_restart_retains_role_credentials(tmp_path: Path) -> None:
    path = tmp_path / "access.json"
    first = load_access(path)
    original_bytes = path.read_bytes()
    assert load_access(path) == first
    assert path.read_bytes() == original_bytes
    assert len(set(first.values())) == 3


@pytest.mark.parametrize("existing", [b"partial-file", b'{"client":"old-password"}'])
def test_gateway_rejects_damaged_handoff_without_reset(tmp_path: Path, existing: bytes) -> None:
    path = tmp_path / "access.json"
    path.write_bytes(existing)
    with pytest.raises(RuntimeError, match="preserve it for recovery"):
        load_access(path)
    assert path.read_bytes() == existing

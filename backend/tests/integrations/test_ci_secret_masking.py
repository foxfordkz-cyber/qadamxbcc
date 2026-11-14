"""Execute the actual CI key-export command and verify its runner masking contract."""

import os
import shlex
import subprocess
import sys
from pathlib import Path

import pytest


def test_ci_generated_key_is_masked_before_next_step(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[3]
    workflow = (root / ".github/workflows/integrations.yml").read_text(encoding="utf-8")
    command = next(
        line.strip()
        for line in workflow.splitlines()
        if line.strip().startswith("python -c ") and "GITHUB_ENV" in line
    )
    _, _, script = shlex.split(command)
    target = tmp_path / "github_env"
    result = subprocess.run(
        [sys.executable, "-c", script],
        env={**os.environ, "GITHUB_ENV": str(target)},
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        pytest.fail("CI key-export command failed; output intentionally withheld")
    exported = dict(line.split("=", 1) for line in target.read_text().splitlines())
    secret = exported.get("BCC_INTEGRATIONS_SIGNING_KEY", "")
    masks = [
        line.removeprefix("::add-mask::")
        for line in result.stdout.splitlines()
        if line.startswith("::add-mask::")
    ]
    # Avoid assertion introspection printing a generated key if this regression fails.
    if len(secret) != 64 or secret not in masks:
        pytest.fail("CI must register its generated key with add-mask before later steps")
    visible = [line for line in result.stdout.splitlines() if not line.startswith("::add-mask::")]
    if any(secret in line for line in visible):
        pytest.fail("CI generated key must not appear in ordinary command output")

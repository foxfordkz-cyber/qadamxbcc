"""Reproducible isolated ecosystem check; never accepts a public target URL."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--storage",
        action="store_true",
        help="Rehearse PostgreSQL/Redis restore and two restarts in isolated Docker containers",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    commands = [
        [sys.executable, "-m", "scripts.export_ecosystem_contract", "--check"],
        [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "tests/test_ecosystem_contract.py",
            "tests/test_mobile_gateway.py",
            "tests/test_jury_hold_review.py",
            "tests/test_second_confirmation.py",
            "tests/test_case_callbacks.py",
            "tests/integrations/test_callback_race.py",
        ],
    ]
    if args.storage:
        commands.append([sys.executable, "-m", "scripts.rehearse_release_storage"])
    for command in commands:
        print("CHECK", " ".join(command[2:]), flush=True)
        subprocess.run(command, cwd=root, check=True)
    npm = shutil.which("npm.cmd" if sys.platform == "win32" else "npm")
    if npm is None:
        raise SystemExit("Node/npm required: client contracts were not checked")
    for client in ("android-app", "frontend"):
        print("CHECK", client, "contracts", flush=True)
        subprocess.run([npm, "test"], cwd=root.parent / client, check=True)
    print(
        "PASS: isolated API/RBAC/Guardian/case/receipt/idempotency contracts"
        + (
            " and PostgreSQL restore/restarts"
            if args.storage
            else "; storage rehearsal not requested"
        )
    )
    print("This does not certify public persistence, live Telegram or a physical Android run.")


if __name__ == "__main__":
    main()

"""Run real database concurrency checks on private Linux/WSL services."""

import os
import secrets
import subprocess
import sys

from scripts.native_rehearsal_storage import NativeStorage
from scripts.rehearse_release_storage import port


def main() -> None:
    pg, redis = port(), port()
    password = secrets.token_hex(20)
    storage = NativeStorage(pg, redis)
    try:
        storage.start(password)
        storage.pg("createdb", "-U", "postgres", "bcc_integration_test_migrations")
        env = {
            **os.environ,
            "BCC_TEST_POSTGRES_URL": (
                f"postgresql+asyncpg://postgres:{password}@127.0.0.1:{pg}/practice"
            ),
            "BCC_TEST_REDIS_URL": f"redis://127.0.0.1:{redis}/15",
            "BCC_TEST_DATABASE_URL": (
                f"postgresql+asyncpg://postgres:{password}@127.0.0.1:{pg}"
                "/bcc_integration_test_migrations"
            ),
        }
        for module in ("verify_merged_migrations", "verify_case_migrations"):
            subprocess.run([sys.executable, "-m", "scripts." + module], env=env, check=True)
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "-q",
                "--basetemp=.pytest_native_tmp",
                "--junitxml=../native-storage-results.xml",
                "tests/test_postgres_concurrency.py",
                "tests/test_postgres_linked_returns.py",
                "tests/test_recipient_flag_postgres.py",
                "tests/test_active_hold_postgres.py",
                "tests/test_guardian_postgres.py",
                "tests/integrations/test_redis_velocity_parity.py",
                "tests/integrations/test_guardian_redis_state.py",
                "tests/integrations/test_live_persistence.py",
                "tests/integrations/test_live_retry.py::test_concurrent_due_retry_sends_once",
                "tests/integrations/test_guardian_cases.py::test_case_concurrent_optimistic_updates_have_one_winner",
                "tests/integrations/test_guardian_operations.py::test_inflight_delivery_serializes_revoke_and_multiple_workers",
                "tests/integrations/test_guardian_reports.py::test_incident_concurrent_replay_and_quota",
                "tests/integrations/test_hosted_telegram.py::test_postgres_runner_lock_handoff",
                "tests/integrations/test_trusted_circle.py::test_circle_concurrent_invites_respect_limit",
            ],
            env=env,
            check=False,
        )
        if result.returncode:
            raise SystemExit(result.returncode)
    finally:
        storage.close()


if __name__ == "__main__":
    main()

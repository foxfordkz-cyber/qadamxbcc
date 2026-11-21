"""CI-only acceptance on isolated localhost PostgreSQL/Redis. No user credentials."""

import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

IMAGE = "qadam-persistent"
CONTAINER = "qadam-persistent-acceptance"
ORIGIN = "http://127.0.0.1:10000"


def docker(*args: str) -> str:
    return subprocess.check_output(["docker", *args], text=True).strip()


def request(path: str, token: str = "", body: Any = None) -> Any:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(
        ORIGIN + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)


def ready() -> None:
    for _ in range(60):
        try:
            if request("/ready") == {"status": "ready"}:
                return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise AssertionError("Persistent API did not become ready")


def main() -> None:
    if os.environ.get("CI") != "true":
        raise SystemExit("Run only against the isolated CI services")
    with tempfile.TemporaryDirectory(prefix="qadam-persistent-") as directory:
        env = Path(directory) / "acceptance.env"
        hashes = docker(
            "run",
            "--rm",
            IMAGE,
            "python",
            "-c",
            "from app.mobile_gateway.passwords import encode; "
            "print('BCC_MOBILE_CLIENT_HASH='+encode('synthetic-ci-client')); "
            "print('BCC_MOBILE_ADMIN_HASH='+encode('synthetic-ci-officer'))",
        )
        env.write_text(
            "DATABASE_URL=postgresql://postgres:synthetic-ci-only@127.0.0.1:5432/qadam\n"
            "BCC_REDIS_URL=redis://127.0.0.1:6379/0\nBCC_ENVIRONMENT=demo\n"
            "BCC_BOOTSTRAP_DEMO=true\nBCC_MOBILE_ENABLED=true\n"
            "BCC_MOBILE_AUTH_MODE=password\nBCC_INTEGRATIONS_ENABLED=true\n"
            "BCC_INTEGRATIONS_ENVIRONMENT=test\nBCC_INTEGRATIONS_TELEGRAM_MODE=fake\n"
            "BCC_INTEGRATIONS_SIGNING_KEY=synthetic-ci-signing-key-only-1234567890\n"
            + hashes
            + "\n",
            encoding="utf-8",
        )
        common = ["--network", "host", "--env-file", str(env)]
        docker("run", "--rm", *common, IMAGE, "sh", "scripts/start-persistent.sh", "migrate")
        try:
            docker("run", "-d", "--name", CONTAINER, *common, IMAGE)
            ready()
            login = request(
                "/mobile/v1/auth/login",
                body={
                    "login": "client_demo",
                    "password": "synthetic-ci-client",
                },
            )
            token = login["token"]
            account = request("/mobile/v1/account", token)
            operations = request("/mobile/v1/wallet/operations", token)
            assert request("/health")["ephemeral_store"] is False
            try:
                request("/mobile/v1/api/soc/feed", token)
                raise AssertionError("Client unexpectedly accessed SOC")
            except urllib.error.HTTPError as exc:
                if exc.code != 403:
                    raise AssertionError("Unexpected client authorization response") from None
            docker("restart", CONTAINER)
            ready()
            assert request("/mobile/v1/account", token) == account
            assert request("/mobile/v1/wallet/operations", token) == operations
            # Running a later predeploy must preserve balances and history.
            docker("run", "--rm", *common, IMAGE, "sh", "scripts/start-persistent.sh", "migrate")
            assert request("/mobile/v1/account", token) == account
            assert request("/mobile/v1/wallet/operations", token) == operations
            print(
                "PASS: password login, client isolation, durable session/data "
                "and idempotent bootstrap"
            )
        finally:
            subprocess.run(["docker", "rm", "-f", CONTAINER], check=False, capture_output=True)


if __name__ == "__main__":
    main()

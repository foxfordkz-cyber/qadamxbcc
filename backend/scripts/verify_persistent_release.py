"""CI-only acceptance on isolated localhost PostgreSQL/Redis. No user credentials."""

import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from decimal import Decimal
from pathlib import Path
from typing import Any

IMAGE = "qadam-persistent"
CONTAINER = "qadam-persistent-acceptance"
WORKER = "qadam-persistent-worker-acceptance"
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


def expect_status(path: str, status: int, token: str = "", body: Any = None) -> None:
    try:
        request(path, token, body)
    except urllib.error.HTTPError as exc:
        if exc.code != status:
            raise AssertionError(f"Expected HTTP {status}, received {exc.code}") from None
        return
    raise AssertionError(f"Expected HTTP {status}")


def worker_ready() -> None:
    for _ in range(30):
        checked = subprocess.run(
            [
                "docker",
                "exec",
                WORKER,
                "python",
                "-c",
                "import os,sys; from redis import Redis; "
                "r=Redis.from_url(os.environ['BCC_REDIS_URL'],socket_timeout=2); "
                "sys.exit(0 if r.get('bcc:integrations:worker:heartbeat') else 1)",
            ],
            capture_output=True,
            timeout=10,
        )
        if checked.returncode == 0:
            return
        time.sleep(1)
    raise AssertionError("Worker did not publish its heartbeat")


def transfer(token: str, phone: str, amount: str, *, active_call: bool = False) -> dict[str, Any]:
    reserved = request("/mobile/v1/requests", token, {})
    body = {
        "request_id": reserved["request_id"],
        "recipient_phone": phone,
        "amount": amount,
        "currency": "KZT",
        "context": {
            "active_call": active_call,
            "from_deposit": active_call,
            "is_new_recipient": phone != "+77010000002",
        },
    }
    return {"body": body, "result": request("/mobile/v1/api/transfers/evaluate", token, body)}


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
        # Exercise the proposed entry-level paid compute envelope, including bootstrap.
        common = [
            "--network",
            "host",
            "--env-file",
            str(env),
            "--memory",
            "512m",
            "--memory-swap",
            "512m",
            "--cpus",
            "0.5",
        ]
        docker("run", "--rm", *common, IMAGE, "sh", "scripts/start-persistent.sh", "migrate")
        try:
            docker("run", "-d", "--name", CONTAINER, *common, IMAGE)
            ready()
            expect_status(
                "/mobile/v1/auth/login",
                401,
                body={"login": "client_demo", "password": "incorrect-synthetic-password"},
            )
            login = request(
                "/mobile/v1/auth/login",
                body={
                    "login": "client_demo",
                    "password": "synthetic-ci-client",
                },
            )
            token = login["token"]
            officer = request(
                "/mobile/v1/auth/login",
                body={"login": "admin_demo", "password": "synthetic-ci-officer"},
            )["token"]
            opening = Decimal(request("/mobile/v1/account", token)["balance"])
            normal = transfer(token, "+77010000002", "25000")
            assert normal["result"]["status"] == "approved"
            cooling = transfer(token, "+77010000003", "900000", active_call=True)
            assert cooling["result"]["status"] == "cooling_off"
            assert cooling["result"]["cooling_off_until"]
            blocked = transfer(token, "+77010000004", "250000")
            assert blocked["result"]["status"] == "blocked"
            account = request("/mobile/v1/account", token)
            assert Decimal(account["balance"]) == opening - Decimal("25000")
            operations = request("/mobile/v1/wallet/operations", token)
            assert request("/health")["ephemeral_store"] is False
            expect_status("/mobile/v1/api/soc/feed", 403, token)
            for submitted in (normal, cooling, blocked):
                ident = submitted["result"]["transaction_id"]
                visible = request(f"/mobile/v1/api/transfers/{ident}", officer)
                for key in ("transaction_id", "status", "recipient"):
                    assert visible[key] == submitted["result"][key], f"SOC mismatch: {key}"
                # PostgreSQL NUMERIC returns two decimals; the initial request may omit them.
                assert Decimal(visible["amount"]) == Decimal(submitted["result"]["amount"])
            docker(
                "run",
                "-d",
                "--name",
                WORKER,
                *common,
                IMAGE,
                "sh",
                "scripts/start-persistent.sh",
                "worker",
            )
            worker_ready()
            docker("restart", CONTAINER)
            ready()
            assert request("/mobile/v1/account", token) == account
            assert request("/mobile/v1/wallet/operations", token) == operations
            replay = request("/mobile/v1/api/transfers/evaluate", token, normal["body"])
            assert replay["transaction_id"] == normal["result"]["transaction_id"]
            assert request("/mobile/v1/account", token) == account
            expect_status(
                "/mobile/v1/api/transfers/evaluate",
                409,
                token,
                {**normal["body"], "amount": "25001"},
            )
            # Remove only this CI worker's heartbeat, so a stale TTL cannot pass recovery.
            docker("stop", WORKER)
            docker(
                "exec",
                CONTAINER,
                "python",
                "-c",
                "import os; from redis import Redis; "
                "from app.integrations.observability import HEARTBEAT; "
                "Redis.from_url(os.environ['BCC_REDIS_URL']).delete(HEARTBEAT)",
            )
            docker("start", WORKER)
            worker_ready()
            # Exact GitHub service-container IDs, never a discovered/shared developer service.
            for variable in ("PERSISTENT_POSTGRES_CONTAINER", "PERSISTENT_REDIS_CONTAINER"):
                dependency = os.environ[variable]
                docker("pause", dependency)
                try:
                    time.sleep(6)  # let readiness's bounded five-second cache expire
                    expect_status("/ready", 503)
                finally:
                    docker("unpause", dependency)
                ready()
                assert request("/mobile/v1/account", token) == account
                assert request("/mobile/v1/wallet/operations", token) == operations
            # Running a later predeploy must preserve balances and history.
            docker("run", "--rm", *common, IMAGE, "sh", "scripts/start-persistent.sh", "migrate")
            assert request("/mobile/v1/account", token) == account
            assert request("/mobile/v1/wallet/operations", token) == operations
            print(
                "PASS: three presets, both roles, unchanged money on replay/conflict, "
                "API/worker restart, PostgreSQL/Valkey failure recovery and idempotent bootstrap"
            )
            print("Observed container memory (not a peak/load benchmark):")
            print(
                docker(
                    "stats", "--no-stream", "--format", "{{.Name}} {{.MemUsage}}", CONTAINER, WORKER
                )
            )
            for name in (CONTAINER, WORKER):
                peak = int(docker("exec", name, "cat", "/sys/fs/cgroup/memory.peak"))
                print(f"{name} observed cgroup peak: {peak / (1024 * 1024):.1f} MiB")
        finally:
            subprocess.run(
                ["docker", "rm", "-f", CONTAINER, WORKER], check=False, capture_output=True
            )


if __name__ == "__main__":
    main()

"""Operate an isolated, fake-only Docker rehearsal. No Telegram network calls.

Run from any directory: python backend/scripts/guardian_demo.py check
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import subprocess
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[2]
PROJECT = "bcc-guardian-rehearsal"
MARKER = "com.bcc-shield.guardian-rehearsal"
SERVICES = ("postgres", "redis", "backend", "frontend", "integrations-worker")
PORTS = {"postgres": 15432, "redis": 16379, "backend": 18000, "frontend": 13000}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> Request | None:
        # A signed local capability must never follow a redirect to another server.
        return None


def probe(key: str) -> dict[str, Any]:
    from app.integrations.capabilities import Principal, issue_token

    opener = build_opener(ProxyHandler({}), NoRedirect())

    def get(path: str, headers: dict[str, str] | None = None) -> Any:
        request = Request(f"http://127.0.0.1:{PORTS['backend']}{path}", headers=headers or {})
        with opener.open(request, timeout=5) as response:
            return json.load(response)

    checks: dict[str, bool] = {"fake_mode": True}  # verified before this function is called
    queue = None
    try:
        checks["api_ready"] = get("/ready").get("status") == "ready"
    except Exception:
        checks["api_ready"] = False
    try:
        token = issue_token(Principal(role="soc", subject=uuid.UUID(int=1)), key, ttl=60)
        health = get("/api/v1/integrations/health/details", {"Authorization": "Bearer " + token})
        for name in ("database", "redis", "worker"):
            checks[name] = health.get(name) == "ok"
        checks["gateway"] = health.get("gateway") == "mock_ready"
        checks["adapter"] = health.get("telegram") == "fake_enabled"
        raw_queue = health.get("queue") or {}
        queue = {
            name: raw_queue.get(name)
            for name in (
                "notifications_queued",
                "notifications_delayed",
                "notifications_failed",
                "runs_pending",
            )
        }
        checks["queue_idle"] = all(type(value) is int and value == 0 for value in queue.values())
    except Exception:
        checks["integration_health"] = False
    return {"checks": checks, "queue": queue}


class DemoError(Exception):
    """Static error codes only; never include command stderr/configuration."""


def clean_environment() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if not k.upper().startswith(("BCC_", "COMPOSE_"))}


def run(args: list[str], *, stdin: str | None = None, timeout: int = 30) -> str:
    try:
        result = subprocess.run(
            args,
            input=stdin,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=clean_environment(),
            cwd=ROOT,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DemoError("command_unavailable_or_timeout") from exc
    if result.returncode:
        raise DemoError("command_failed")
    return result.stdout


def containers() -> list[dict[str, Any]]:
    ids = run(
        ["docker", "ps", "-aq", "--filter", f"label=com.docker.compose.project={PROJECT}"]
    ).split()
    if not ids:
        # A retained volume without its containers has no recoverable signing key
        # or checkout ownership proof. Never silently adopt/reseed it.
        volumes = run(["docker", "volume", "ls", "-q"]).splitlines()
        if f"{PROJECT}_pgdata" in volumes:
            raise DemoError("orphaned_rehearsal_volume_refused")
        return []
    data: list[dict[str, Any]] = json.loads(run(["docker", "inspect", *ids]))
    validate_ownership(data)
    return data


def validate_ownership(data: list[dict[str, Any]]) -> None:
    for item in data:
        labels = item.get("Config", {}).get("Labels", {})
        if (
            labels.get(MARKER) != "1"
            or labels.get("com.docker.compose.project") != PROJECT
            or labels.get("com.docker.compose.service") not in SERVICES
            or Path(labels.get("com.docker.compose.project.working_dir", "")).resolve() != ROOT
        ):
            raise DemoError("foreign_project_refused")


def environment(item: dict[str, Any]) -> dict[str, str]:
    return dict(entry.split("=", 1) for entry in item["Config"]["Env"] if "=" in entry)


def safe_configuration(data: list[dict[str, Any]]) -> str | None:
    keys = set()
    for item in data:
        service = item["Config"]["Labels"]["com.docker.compose.service"]
        if service not in {"backend", "integrations-worker"}:
            continue
        cfg = environment(item)
        required = fake_environment("unused")
        for name, value in required.items():
            if name != "BCC_INTEGRATIONS_SIGNING_KEY" and cfg.get(name) != value:
                raise DemoError("unsafe_runtime_configuration")
        key = cfg.get("BCC_INTEGRATIONS_SIGNING_KEY", "")
        if len(key) < 32:
            raise DemoError("invalid_demo_key")
        keys.add(key)
    if len(keys) > 1:
        raise DemoError("inconsistent_demo_keys")
    return next(iter(keys), None)


def fake_environment(key: str) -> dict[str, str]:
    return {
        "BCC_DATABASE_URL": "postgresql+asyncpg://bcc:bcc@postgres:5432/bcc_shield",
        "BCC_REDIS_URL": "redis://redis:6379/0",
        "BCC_ENVIRONMENT": "demo",
        "BCC_BOOTSTRAP_DEMO": "true",
        "BCC_ALLOW_DEMO_OVERRIDES": "true",
        "BCC_INTEGRATIONS_ENABLED": "true",
        "BCC_INTEGRATIONS_ENVIRONMENT": "local",
        "BCC_INTEGRATIONS_TELEGRAM_MODE": "fake",
        "BCC_INTEGRATIONS_TELEGRAM_TOKEN": "",
        "BCC_INTEGRATIONS_TELEGRAM_ALLOWED_CHAT_IDS": "[]",
        "BCC_INTEGRATIONS_SIGNING_KEY": key,
        "BCC_INTEGRATIONS_GATEWAY_ENABLED": "true",
    }


def overlay(key: str) -> str:
    services: dict[str, Any] = {name: {"labels": {MARKER: "1"}} for name in SERVICES}
    for name in ("backend", "integrations-worker"):
        services[name]["environment"] = fake_environment(key)
    # Ports are interpolated in the base file via a controlled environment, below.
    services["backend"]["environment"]["BCC_CORS_ORIGINS"] = '["http://localhost:13000"]'
    return json.dumps({"services": services})


def compose(args: list[str], key: str, *, timeout: int = 30) -> str:
    # Only non-secret fixed port variables are in the child environment. Compose
    # receives the key via stdin; it is never a command argument or local file.
    port_env = {
        f"BCC_{name}_PORT": str(PORTS[service])
        for name, service in (
            ("POSTGRES", "postgres"),
            ("REDIS", "redis"),
            ("BACKEND", "backend"),
            ("WEB", "frontend"),
        )
    }
    command = [
        "docker",
        "compose",
        "--env-file",
        os.devnull,
        "--project-name",
        PROJECT,
        "-f",
        str(ROOT / "docker-compose.yml"),
        "-f",
        str(ROOT / "docker-compose.integrations.yml"),
        "-f",
        "-",
        "--profile",
        "integrations",
        *args,
    ]
    try:
        result = subprocess.run(
            command,
            input=overlay(key),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env={**clean_environment(), **port_env},
            cwd=ROOT,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DemoError("compose_unavailable_or_timeout") from exc
    if result.returncode:
        raise DemoError("compose_failed")
    return result.stdout


def backend_exec(args: list[str], data: list[dict[str, Any]], timeout: int = 30) -> str:
    validate_ownership(data)
    safe_configuration(data)
    backend = next(
        (
            item
            for item in data
            if item["Config"]["Labels"]["com.docker.compose.service"] == "backend"
        ),
        None,
    )
    if backend is None:
        raise DemoError("backend_not_created")
    return run(["docker", "exec", backend["Id"], *args], timeout=timeout)


def reset_owned_data(data: list[dict[str, Any]]) -> None:
    """Called only after explicit reset flag and stopping API/worker writers."""
    validate_ownership(data)
    safe_configuration(data)
    ids = {item["Config"]["Labels"]["com.docker.compose.service"]: item["Id"] for item in data}
    run(
        [
            "docker",
            "exec",
            ids["postgres"],
            "psql",
            "-U",
            "bcc",
            "-d",
            "bcc_shield",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            "DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
        ],
        timeout=60,
    )
    run(["docker", "exec", ids["redis"], "redis-cli", "-n", "0", "FLUSHDB"])


def check(data: list[dict[str, Any]]) -> dict[str, Any]:
    key = safe_configuration(data)
    states = {
        item["Config"]["Labels"]["com.docker.compose.service"]: item.get("State", {})
        .get("Health", {})
        .get("Status")
        == "healthy"
        and item.get("State", {}).get("Running") is True
        for item in data
    }
    checks = {f"container_{name}": states.get(name, False) for name in SERVICES}
    queue = None
    if checks["container_backend"] and key:
        result = probe(key)
        checks.update(result["checks"])
        queue = result.get("queue")
    for name, path in (("frontend_http", "/health"), ("frontend_proxy", "/api/v1/soc/feed")):
        try:
            with build_opener(ProxyHandler({})).open(
                f"http://127.0.0.1:{PORTS['frontend']}{path}", timeout=5
            ) as response:
                checks[name] = response.status == 200
        except Exception:
            checks[name] = False
    return {
        "success": all(checks.values()),
        "checks": checks,
        "queue": queue,
        "scope": "fake_local_demo_only",
        "live_telegram": False,
        "web_url": "http://localhost:13000",
    }


def rehearsal_run(key: str) -> str:
    # Reuse the backend development environment; httpx is intentionally not added
    # to the production image just for this demo driver.
    try:
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "scripts.demo_operations",
                "--base-url",
                "http://127.0.0.1:18000",
            ],
            cwd=ROOT / "backend",
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
            check=False,
            env={
                **clean_environment(),
                **fake_environment(key),
                "NO_PROXY": "localhost,127.0.0.1",
                "no_proxy": "localhost,127.0.0.1",
            },
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DemoError("rehearsal_unavailable_or_timeout") from exc
    if result.returncode:
        raise DemoError("rehearsal_failed_check_backend_dev_dependencies_and_seed")
    return result.stdout


def execute(
    action: str, *, no_build: bool = False, reset_synthetic: bool = False
) -> dict[str, Any]:
    data = containers()
    if action == "check":
        return check(data)
    if action == "stop":
        # Stop is allowed even when our containers have drifted; never remove volumes.
        if data:
            run(["docker", "stop", *[item["Id"] for item in data]], timeout=120)
        return {"success": True, "stopped": len(data), "volumes_preserved": True}
    saved_key = safe_configuration(data)
    if data and saved_key is None:
        raise DemoError("partial_stack_without_signing_key")
    key = saved_key or secrets.token_hex(32)
    if action == "start":
        if not no_build:
            print("Building isolated demo images (bounded to 15 minutes).", file=sys.stderr)
            compose(["build"], key, timeout=900)
        print("Waiting for demo services (bounded to 10 minutes).", file=sys.stderr)
        compose(["up", "-d", "--wait", "--wait-timeout", "600"], key, timeout=660)
        return check(containers())
    if not reset_synthetic:
        raise DemoError("rehearsal_requires_reset_synthetic_flag")
    if not check(data)["success"]:
        raise DemoError("run_check_before_rehearsal")
    # Explicit reset is restricted to this labelled synthetic stack, never another project.
    compose(["stop", "backend", "integrations-worker"], key, timeout=60)
    reset_owned_data(data)
    # Backend startup applies migrations and bootstraps the empty synthetic database.
    compose(["up", "-d", "--wait", "--wait-timeout", "600"], key, timeout=660)
    output = rehearsal_run(key)
    expected = {
        "normal",
        "scam",
        "hub",
        "guardian_report",
        "soc_case_lifecycle",
        "operations_privacy",
    }
    passed = set()
    for line in output.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if (
            isinstance(row, dict)
            and row.get("result") == "PASS"
            and row.get("scenario") in expected
        ):
            passed.add(row["scenario"])
    return {
        "success": passed == expected,
        "passed_scenarios": sorted(passed),
        "expected_scenarios": sorted(expected),
        "live_telegram": False,
        "synthetic_data_reset": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("start", "check", "rehearse", "stop"))
    parser.add_argument("--no-build", action="store_true", help="reuse existing images on start")
    parser.add_argument(
        "--reset-synthetic",
        action="store_true",
        help="re-seed ONLY this isolated rehearsal database; required for rehearse",
    )
    args = parser.parse_args()
    try:
        report = execute(args.action, no_build=args.no_build, reset_synthetic=args.reset_synthetic)
    except DemoError as exc:
        report = {"success": False, "error": str(exc)}
    except Exception:
        report = {"success": False, "error": "unexpected_failure"}
    report.update(action=args.action, project=PROJECT, checked_at=datetime.now(UTC).isoformat())
    print(json.dumps(report, ensure_ascii=True))
    return 0 if report["success"] else 1


if __name__ == "__main__":
    sys.exit(main())

"""Isolation, configuration and failure checks for the local demo operator tool."""

import json
import os
import subprocess
from typing import Any

import pytest

from scripts import guardian_demo as demo


def container(service: str = "backend") -> dict[str, Any]:
    return {
        "Id": "synthetic-container",
        "Config": {
            "Labels": {
                demo.MARKER: "1",
                "com.docker.compose.project": demo.PROJECT,
                "com.docker.compose.service": service,
                "com.docker.compose.project.working_dir": str(demo.ROOT),
            },
            "Env": [f"{key}={value}" for key, value in demo.fake_environment("k" * 64).items()],
        },
        "State": {"Running": True, "Health": {"Status": "healthy"}},
    }


@pytest.mark.parametrize(
    ("label", "value"),
    [
        (demo.MARKER, "0"),
        ("com.docker.compose.project", "someone-else"),
        ("com.docker.compose.service", "telegram-poller"),
        ("com.docker.compose.project.working_dir", "/another-checkout"),
    ],
)
def test_foreign_containers_are_never_operated(label: str, value: str) -> None:
    item = container()
    item["Config"]["Labels"][label] = value
    with pytest.raises(demo.DemoError, match="foreign_project_refused"):
        demo.validate_ownership([item])


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("BCC_ENVIRONMENT", "pilot"),
        ("BCC_INTEGRATIONS_TELEGRAM_MODE", "test"),
        ("BCC_INTEGRATIONS_TELEGRAM_TOKEN", "synthetic-secret"),
        ("BCC_INTEGRATIONS_TELEGRAM_ALLOWED_CHAT_IDS", "[123]"),
        ("BCC_DATABASE_URL", "postgresql+asyncpg://external.invalid/real"),
        ("BCC_REDIS_URL", "redis://external.invalid/0"),
    ],
)
def test_runtime_configuration_drift_fails_closed(name: str, value: str) -> None:
    item = container()
    cfg = demo.fake_environment("k" * 64)
    cfg[name] = value
    item["Config"]["Env"] = [f"{key}={val}" for key, val in cfg.items()]
    with pytest.raises(demo.DemoError, match="unsafe_runtime_configuration"):
        demo.safe_configuration([item])


def test_start_reuses_existing_key_and_forces_fake(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BCC_INTEGRATIONS_TELEGRAM_MODE", "test")
    monkeypatch.setenv("BCC_INTEGRATIONS_TELEGRAM_TOKEN", "synthetic-secret")
    monkeypatch.setenv("COMPOSE_FILE", "unrelated.yml")
    monkeypatch.setattr(demo, "containers", lambda: [container()])
    monkeypatch.setattr(demo, "check", lambda data: {"success": True})
    calls: list[dict[str, Any]] = []

    def compose(args: list[str], key: str, *, timeout: int) -> str:
        calls.append({"args": args, "key": key, "overlay": json.loads(demo.overlay(key))})
        assert timeout > 0
        return ""

    monkeypatch.setattr(demo, "compose", compose)
    assert demo.execute("start", no_build=True)["success"]
    assert calls[0]["key"] == "k" * 64
    env = calls[0]["overlay"]["services"]["backend"]["environment"]
    assert env["BCC_INTEGRATIONS_TELEGRAM_MODE"] == "fake"
    assert env["BCC_INTEGRATIONS_TELEGRAM_TOKEN"] == ""
    assert "BCC_INTEGRATIONS_TELEGRAM_TOKEN" not in demo.clean_environment()
    assert "COMPOSE_FILE" not in demo.clean_environment()
    assert "--build" not in calls[0]["args"]


def test_stop_uses_only_owned_ids_and_preserves_volumes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(demo, "containers", lambda: [container()])
    calls = []

    def run(args: list[str], *, timeout: int) -> str:
        calls.append(args)
        return ""

    monkeypatch.setattr(demo, "run", run)
    assert demo.execute("stop") == {"success": True, "stopped": 1, "volumes_preserved": True}
    assert calls == [["docker", "stop", "synthetic-container"]]


def test_reset_requires_explicit_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(demo, "containers", lambda: [container()])
    with pytest.raises(demo.DemoError, match="reset_synthetic_flag"):
        demo.execute("rehearse")


def test_empty_or_stopped_stack_cannot_report_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    def unavailable(*args: Any, **kwargs: Any) -> Any:
        raise OSError("unavailable")

    monkeypatch.setattr(demo, "build_opener", unavailable)
    result = demo.check([])
    assert result["success"] is False
    assert not any(result["checks"].values())


def test_command_error_never_exposes_stderr_or_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    def failed(*args: Any, **kwargs: Any) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(args[0], 1, "", "synthetic-secret")

    monkeypatch.setattr(subprocess, "run", failed)
    with pytest.raises(demo.DemoError, match=r"^command_failed$"):
        demo.run(["docker", "info"])


def test_compose_key_is_stdin_only_and_env_file_is_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key = "synthetic-secret" * 4

    def capture(args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        assert key not in " ".join(args)
        assert key in kwargs["input"]
        assert key not in json.dumps(kwargs["env"])
        assert args[args.index("--env-file") + 1] == os.devnull
        assert kwargs["env"]["BCC_BACKEND_PORT"] == "18000"
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(subprocess, "run", capture)
    demo.compose(["up", "-d"], key)


def test_inconsistent_keys_refuse_restart() -> None:
    worker = container("integrations-worker")
    worker["Config"]["Env"] = [
        f"{key}={value}" for key, value in demo.fake_environment("different" * 8).items()
    ]
    with pytest.raises(demo.DemoError, match="inconsistent_demo_keys"):
        demo.safe_configuration([container(), worker])


def test_orphaned_volume_is_not_adopted(monkeypatch: pytest.MonkeyPatch) -> None:
    def run(args: list[str]) -> str:
        return f"{demo.PROJECT}_pgdata\n" if "volume" in args else ""

    monkeypatch.setattr(demo, "run", run)
    with pytest.raises(demo.DemoError, match="orphaned_rehearsal_volume_refused"):
        demo.containers()


def test_reset_can_only_target_verified_project(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def run(args: list[str], *, timeout: int = 30) -> str:
        calls.append(args)
        return ""

    monkeypatch.setattr(demo, "run", run)
    data = [container(name) for name in demo.SERVICES]
    data[0]["Config"]["Labels"][demo.MARKER] = "0"
    with pytest.raises(demo.DemoError, match="foreign_project_refused"):
        demo.reset_owned_data(data)
    assert not calls

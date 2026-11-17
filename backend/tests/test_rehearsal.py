import asyncio
import io
import json
import sys
from dataclasses import replace
from pathlib import Path

import pytest

from app.models import TransactionStatus
from scripts import rehearse_demo
from scripts.seed_bcc import DEMO_PRESETS


async def test_rehearsal_proves_three_real_decisions_and_preserves_existing_state(
    tmp_path: Path,
) -> None:
    preserved = tmp_path / "local-demo.db"
    preserved.write_bytes(b"Existing preview is not a rehearsal target")
    report = await rehearse_demo.run_rehearsal(state_root=tmp_path)
    assert report["success"], report.get("failure")
    assert [item["status"] for item in report["scenarios"]] == [
        "approved",
        "cooling_off",
        "blocked",
    ]
    assert all(item["ml_model_version"] for item in report["scenarios"])
    checks = {item["name"]: item["passed"] for item in report["checks"]}
    assert checks["hold_and_explanation_survive_restart"]
    assert checks["late_abandoned_intent_never_executes"]
    assert checks["clean_answers_never_release_early"]
    assert checks["dropper_graph_evidence"]
    assert preserved.read_bytes() == b"Existing preview is not a rehearsal target"
    assert await asyncio.to_thread(lambda: list(tmp_path.iterdir())) == [preserved]


async def test_rehearsal_fails_when_a_demo_decision_is_wrong(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    normal = DEMO_PRESETS[0]
    monkeypatch.setattr(
        rehearse_demo, "DEMO_PRESETS", (replace(normal, expected=TransactionStatus.BLOCKED),)
    )
    report = await rehearse_demo.run_rehearsal(state_root=tmp_path)
    assert report["success"] is False
    assert report["failure"]["message"] == "normal_decision"
    assert report["checks"][-1] == {"name": "normal_decision", "passed": False}


def test_json_report_supports_kazakh_on_legacy_windows_stdout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def result() -> dict[str, object]:
        return {"success": True, "reason": "Қауіпсіздік"}

    buffer = io.BytesIO()
    legacy_console = io.TextIOWrapper(buffer, encoding="cp1251", write_through=True)
    with monkeypatch.context() as scoped:
        scoped.setattr(rehearse_demo, "run_rehearsal", result)
        scoped.setattr(sys, "argv", ["rehearse_demo"])
        scoped.setattr(sys, "stdout", legacy_console)
        with pytest.raises(SystemExit) as exited:
            rehearse_demo.main()
        assert exited.value.code == 0
    assert json.loads(buffer.getvalue()) == {"success": True, "reason": "Қауіпсіздік"}

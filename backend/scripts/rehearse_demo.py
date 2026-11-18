"""Rehearse the real application in a disposable SQLite DB, never the running preview.

From backend: uv run python -m scripts.rehearse_demo [--output ../.local-checks/report.json]
Stdout is JSON. Startup diagnostics go to stderr. Exit zero means every check passed.
This is an in-process ASGI functional check with fakeredis, not a latency/load benchmark.
"""

import argparse
import asyncio
import json
import math
import sys
import time
import uuid
from contextlib import redirect_stdout
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from httpx import ASGITransport, AsyncClient

from app.schemas.soc import FeedResponse, GraphResponse
from app.schemas.transfers import TransferEvaluateResponse
from scripts.run_local_demo import (
    DEMO_STATE,
    create_demo_app,
    prepare_database,
    require_demo_environment,
)
from scripts.seed_bcc import DEMO_PRESETS, HUB_ID

CLEAN_ANSWERS = {
    "caller_claims_bank_or_police": False,
    "asked_to_move_to_safe_account": False,
    "asked_to_keep_secret_or_install_app": False,
    "initiated_by_customer": True,
    "knows_recipient_personally": True,
}


class RehearsalError(RuntimeError):
    pass


async def run_rehearsal(*, state_root: Path = DEMO_STATE) -> dict[str, Any]:
    require_demo_environment()
    started = time.perf_counter()
    report: dict[str, Any] = {
        "schema_version": 1,
        "checked_at": datetime.now(UTC).isoformat(),
        "run_id": str(uuid.uuid4()),
        "success": False,
        "synthetic_data_only": True,
        "database": "disposable SQLite",
        "redis": "fakeredis (in-process)",
        "transport": "ASGI in-process; no network server or preview requests",
        "timing_scope": "functional rehearsal; not a Redis, network or banking-load benchmark",
        "checks": [],
        "scenarios": [],
    }

    def check(name: str, passed: bool, **details: Any) -> None:
        report["checks"].append({"name": name, "passed": passed, **details})
        if not passed:
            raise RehearsalError(name)

    async def response(
        client: AsyncClient, method: str, path: str, *, expected: int = 200, **kwargs: Any
    ) -> Any:
        result = await client.request(method, path, **kwargs)
        if result.status_code != expected:
            raise RehearsalError(f"{method} {path}: expected {expected}, got {result.status_code}")
        return result.json()

    await asyncio.to_thread(state_root.mkdir, parents=True, exist_ok=True)
    try:
        with TemporaryDirectory(prefix="preflight-", dir=state_root) as temporary:
            url = await asyncio.to_thread(prepare_database, Path(temporary) / "rehearsal.db")
            saved: dict[str, TransferEvaluateResponse] = {}
            originals: dict[str, dict[str, Any]] = {}
            requests: dict[str, dict[str, object]] = {}
            app = create_demo_app(url)
            async with (
                app.router.lifespan_context(app),
                AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://rehearsal"
                ) as client,
            ):
                health = await response(client, "GET", "/health")
                ready = await response(client, "GET", "/ready")
                check(
                    "health_and_dependencies",
                    health["status"] == "ok" and ready["status"] == "ready",
                )
                before = FeedResponse.model_validate(
                    await response(client, "GET", "/api/v1/soc/feed")
                )
                for preset in DEMO_PRESETS:
                    payload = {**preset.payload(), "request_id": str(uuid.uuid4())}
                    if preset.key == "scam":
                        payload["context"] = {
                            **preset.context,
                            "pasted_recipient": True,
                            "typing_duration_ms": 1200,
                            "hesitation_count": 1,
                        }
                    raw = await response(client, "POST", "/api/v1/transfers/evaluate", json=payload)
                    evaluated = TransferEvaluateResponse.model_validate(raw)
                    saved[preset.key], originals[preset.key], requests[preset.key] = (
                        evaluated,
                        raw,
                        payload,
                    )
                    check(f"{preset.key}_decision", evaluated.status is preset.expected)
                    check(
                        f"{preset.key}_local_ml",
                        evaluated.ml_score is not None
                        and math.isfinite(evaluated.ml_score)
                        and bool(evaluated.ml_model_version)
                        and bool(evaluated.ml_contributors),
                    )
                    check(
                        f"{preset.key}_bilingual_explanation",
                        bool(evaluated.headline_kk)
                        and bool(evaluated.headline_ru)
                        and all(
                            reason.reason_kk and reason.reason_ru for reason in evaluated.reasons
                        ),
                    )
                    report["scenarios"].append(
                        {
                            "key": preset.key,
                            "expected": preset.expected.value,
                            "status": evaluated.status.value,
                            "risk_score": evaluated.risk_score,
                            "ml_score": evaluated.ml_score,
                            "ml_model_version": evaluated.ml_model_version,
                            "ml_contributors": [
                                contributor.model_dump()
                                for contributor in evaluated.ml_contributors
                            ],
                            "recipient_graph": evaluated.recipient_graph,
                            "velocity": evaluated.velocity,
                            "scorer_latency_ms": evaluated.latency_ms,
                            "reason_codes": [reason.code for reason in evaluated.reasons],
                        }
                    )
                check(
                    "real_paste_signal_explained",
                    "PASTED_DURING_CALL" in {reason.code for reason in saved["scam"].reasons},
                )
                replay = await response(
                    client, "POST", "/api/v1/transfers/evaluate", json=requests["normal"]
                )
                check("identical_request_replays_original", replay == originals["normal"])
                after = FeedResponse.model_validate(
                    await response(client, "GET", "/api/v1/soc/feed")
                )
                check("only_three_new_operations", after.stats.total == before.stats.total + 3)
                visible = {str(item.transaction_id): item for item in after.items}
                check(
                    "soc_has_all_three_decisions",
                    all(
                        str(value.transaction_id) in visible
                        and visible[str(value.transaction_id)].status is value.status
                        for value in saved.values()
                    ),
                )
                graph = GraphResponse.model_validate(
                    await response(client, "GET", f"/api/v1/soc/graph/{HUB_ID}")
                )
                hub = next(node for node in graph.nodes if node.id == str(HUB_ID))
                check(
                    "dropper_graph_evidence",
                    hub.data.in_degree >= 12
                    and hub.data.suspected_mule
                    and hub.data.shared_device_accounts >= 1
                    and any(edge.data.edge_type == "shared_device" for edge in graph.edges),
                    incoming_accounts=hub.data.in_degree,
                    graph_nodes=len(graph.nodes),
                )
                held = saved["scam"]
                remaining = (
                    (held.cooling_off_until - held.server_time).total_seconds()
                    if held.cooling_off_until
                    else 0
                )
                check("server_hold_is_fifteen_minutes", 895 <= remaining <= 900, seconds=remaining)
                verified = await response(
                    client,
                    "POST",
                    f"/api/v1/transfers/{held.transaction_id}/resolve-cooling",
                    json={"answers": CLEAN_ANSWERS},
                )
                check("clean_answers_never_release_early", verified["status"] == "cooling_off")

            # New app/resources means new in-memory graph and Redis; only SQLite survives.
            restarted = create_demo_app(url)
            async with (
                restarted.router.lifespan_context(restarted),
                AsyncClient(
                    transport=ASGITransport(app=restarted), base_url="http://rehearsal"
                ) as client,
            ):
                ready = await response(client, "GET", "/ready")
                check("restart_ready", ready["status"] == "ready")
                recovered = TransferEvaluateResponse.model_validate(
                    await response(client, "GET", f"/api/v1/transfers/{held.transaction_id}")
                )
                check(
                    "hold_and_explanation_survive_restart",
                    recovered.status.value == "cooling_off"
                    and recovered.ml_score == held.ml_score
                    and recovered.verification_answers is not None
                    and recovered.verification_answers.model_dump() == CLEAN_ANSWERS,
                )
                cancelled = await response(
                    client, "POST", f"/api/v1/transfers/{held.transaction_id}/cancel", json={}
                )
                check("customer_cancels_without_execution", cancelled["status"] == "cancelled")
                await response(
                    client,
                    "POST",
                    f"/api/v1/transfers/{held.transaction_id}/resolve-cooling",
                    expected=409,
                    json={"answers": CLEAN_ANSWERS},
                )
                check("cancelled_hold_cannot_release", True)
                identity = str(uuid.uuid4())
                abandoned = await response(
                    client, "POST", f"/api/v1/transfers/requests/{identity}/abandon", json={}
                )
                check("unknown_intent_abandoned", abandoned["status"] == "abandoned")
                await response(
                    client,
                    "POST",
                    "/api/v1/transfers/evaluate",
                    expected=409,
                    json={**requests["normal"], "request_id": identity},
                )
                final = FeedResponse.model_validate(
                    await response(client, "GET", "/api/v1/soc/feed")
                )
                check(
                    "late_abandoned_intent_never_executes",
                    final.stats.total == before.stats.total + 3,
                )
                report["success"] = True
    except Exception as exc:
        report["failure"] = {"type": type(exc).__name__, "message": str(exc)}
    report["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, help="Create a new JSON report; existing files are refused"
    )
    args = parser.parse_args()
    if args.output and args.output.exists():
        parser.error("Report already exists; choose a new filename")
    try:
        with redirect_stdout(sys.stderr):
            report = asyncio.run(run_rehearsal())
    except Exception as exc:
        report = {
            "schema_version": 1,
            "success": False,
            "failure": {"type": type(exc).__name__, "message": str(exc)},
        }
    rendered = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as output:
            output.write(rendered + "\n")
    # ASCII JSON escapes keep Kazakh labels valid on legacy Windows console encodings.
    # The optional artifact above remains readable UTF-8.
    print(json.dumps(report, ensure_ascii=True, indent=2, allow_nan=False))
    raise SystemExit(0 if report["success"] else 1)


if __name__ == "__main__":
    main()

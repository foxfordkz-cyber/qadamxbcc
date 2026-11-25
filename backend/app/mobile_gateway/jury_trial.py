"""Room-scoped blind comparison of familiar-payee call decisions on synthetic CSVs."""

import asyncio
import csv
from dataclasses import asdict
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from app.mobile_gateway.jury_rooms import ROOM_COOKIE, RoomPool, same_origin
from scripts.blind_call_trial import (
    Case,
    FrozenRun,
    Label,
    digest,
    freeze_cases,
    grade,
    inspect_csv,
)

MAX_BYTES = 32_768
MAX_ROWS = 32
NO_STORE = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}
HTML = Path(__file__).with_name("jury_trial.html")


def failure(code: str, status: int = 422) -> JSONResponse:
    return JSONResponse({"error": code}, status_code=status, headers=NO_STORE)


async def csv_body(request: Request) -> bytes:
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "text/csv":
        raise ValueError("format")
    body = bytearray()
    async with asyncio.timeout(10):
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_BYTES:
                raise ValueError("file_limit")
            body.extend(chunk)
    return bytes(body)


def install_trial(app: FastAPI, pool: RoomPool) -> None:
    scoring = asyncio.Lock()

    @app.get("/jury/trial/example/{kind}")
    async def example(kind: Literal["cases", "labels"]) -> FileResponse:
        filename = "blind-call-example" + ("-labels" if kind == "labels" else "") + ".csv"
        root = HTML.resolve().parents[2]
        packaged = root / "examples" / filename
        source = packaged if packaged.is_file() else root.parent / "docs" / "evidence" / filename
        return FileResponse(source, filename=filename, media_type="text/csv")

    @app.get("/jury/trial")
    async def trial_page() -> FileResponse:
        return FileResponse(
            HTML,
            media_type="text/html",
            headers={
                **NO_STORE,
                "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'; "
                "object-src 'none'; base-uri 'none'; form-action 'self'",
            },
        )

    @app.get("/jury/trial/state")
    async def state(request: Request) -> JSONResponse:
        with pool.borrow(request.cookies.get(ROOM_COOKIE)) as room:
            saved = room.trial_forecast if room else None
            return JSONResponse(
                {
                    "room": room is not None,
                    "sha256": digest(saved) if saved else None,
                    "count": len(FrozenRun.model_validate_json(saved).decisions) if saved else 0,
                },
                headers=NO_STORE,
            )

    @app.get("/jury/trial/forecast/{sha}")
    async def download(sha: str, request: Request) -> Response:
        with pool.borrow(request.cookies.get(ROOM_COOKIE)) as room:
            frozen = room.trial_forecast if room else None
            if not frozen or sha != digest(frozen):
                return failure("forecast_changed", 404)
            return Response(
                frozen,
                media_type="application/json",
                headers={**NO_STORE, "Content-Disposition": 'attachment; filename="forecast.json"'},
            )

    @app.post("/jury/trial/{action}")
    async def upload(
        request: Request, action: Literal["preview", "freeze", "grade"], sha: str = ""
    ) -> JSONResponse:
        if not same_origin(request):
            return failure("origin", 403)
        with pool.borrow(request.cookies.get(ROOM_COOKIE)) as room:
            if room is None:
                return failure("room", 401)
            try:
                data = await csv_body(request)
                if action == "grade":
                    frozen = room.trial_forecast
                    if not frozen or sha != digest(frozen):
                        return failure("forecast_changed", 409)
                    _, issues = inspect_csv(data, Label, MAX_ROWS)
                    if issues:
                        return JSONResponse(
                            {"error": "rows", "issues": [asdict(i) for i in issues]},
                            status_code=422,
                            headers=NO_STORE,
                        )
                    results = grade(frozen, sha, data)
                    return JSONResponse(
                        {name: asdict(counts) for name, counts in results.items()},
                        headers=NO_STORE,
                    )
                cases, issues = inspect_csv(data, Case, MAX_ROWS)
            except TimeoutError:
                return failure("read_timeout", 408)
            except (UnicodeError, csv.Error):
                return failure("format")
            except ValueError as exc:
                reason = str(exc)
                if reason in {"file_limit", "row_limit"}:
                    return failure(reason, 413)
                if reason.startswith("Labels must match"):
                    return failure("label_ids")
                return failure("format")
            report = {"accepted": len(cases), "issues": [asdict(i) for i in issues]}
            if action == "preview":
                return JSONResponse(report, headers=NO_STORE)
            if not cases:
                return failure("no_cases")
            if scoring.locked():
                return failure("busy", 429)
            async with scoring:
                decisions = await freeze_cases(data, cases)
                frozen = (decisions.model_dump_json(indent=2) + "\n").encode()
                room.trial_forecast = frozen
            return JSONResponse({**report, "sha256": digest(frozen)}, headers=NO_STORE)

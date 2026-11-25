from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from starlette.types import ASGIApp

from app.mobile_gateway.jury_rooms import create_jury_app
from scripts.blind_call_trial import digest

ORIGIN = "https://trial.test"
CSV = {"Origin": ORIGIN, "Content-Type": "text/csv"}


@asynccontextmanager
async def room(_: int) -> AsyncIterator[ASGIApp]:
    yield FastAPI()


async def test_jury_blind_csv_partial_rows_commitment_and_room_isolation() -> None:
    api = create_jury_app(room)
    transport = ASGITransport(app=api)
    async with (
        api.router.lifespan_context(api),
        AsyncClient(transport=transport, base_url=ORIGIN) as owner,
        AsyncClient(transport=transport, base_url=ORIGIN) as guest,
    ):
        trial_page = await owner.get("/jury/trial")
        assert 'lang="kk"' in trial_page.text
        assert trial_page.headers["Referrer-Policy"] == "same-origin"
        cases = (await owner.get("/jury/trial/example/cases")).content
        labels = (await owner.get("/jury/trial/example/labels")).content
        data = cases.rstrip() + b"\nbad,0,30000,5,100,0,0\n"
        assert (
            await owner.post("/jury/trial/freeze", headers=CSV, content=data)
        ).status_code == 401
        start = await owner.post("/jury/start/trial", headers={"Origin": ORIGIN})
        assert start.headers["location"] == "/jury/trial"
        response = await owner.post("/jury/trial/preview", headers=CSV, content=data)
        assert response.json() == {
            "accepted": 2,
            "issues": [{"line": 4, "code": "field", "field": "amount_kzt"}],
        }
        assert (await owner.get("/jury/trial/state")).json()["sha256"] is None
        wrong = {**CSV, "Origin": "https://another.test"}
        assert (
            await owner.post("/jury/trial/freeze", headers=wrong, content=data)
        ).status_code == 403
        result = await owner.post("/jury/trial/freeze", headers=CSV, content=data)
        sha = result.json()["sha256"]
        url = f"/jury/trial/forecast/{sha}"
        assert digest((await owner.get(url)).content) == sha
        assert (await guest.get(url)).status_code == 404
        assert (await owner.get("/jury/trial/state")).json()["count"] == 2
        grade = await owner.post(f"/jury/trial/grade?sha={sha}", headers=CSV, content=labels)
        for counts in grade.json().values():
            assert counts["caught"] + counts["missed"] == 1
            assert counts["false_pauses"] + counts["honest_approved"] == 1
        mismatch = await owner.post(
            f"/jury/trial/grade?sha={sha}", headers=CSV, content=labels.replace(b"example_A", b"c")
        )
        assert mismatch.json() == {"error": "label_ids"}
        new = await owner.post("/jury/trial/freeze", headers=CSV, content=cases)
        assert new.json()["sha256"] != sha
        old = await owner.post(f"/jury/trial/grade?sha={sha}", headers=CSV, content=labels)
        assert old.status_code == 409
        repeated = await owner.post("/jury/trial/freeze", headers=CSV, content=cases)
        assert repeated.json()["sha256"] == new.json()["sha256"]
        too_big = await owner.post("/jury/trial/preview", headers=CSV, content=b"x" * 32769)
        assert too_big.status_code == 413
        head, *rows = cases.splitlines()
        duplicated = b"\n".join([head, rows[0], rows[0], rows[1]])
        preview = (await owner.post("/jury/trial/preview", headers=CSV, content=duplicated)).json()
        assert preview["accepted"] == 1
        assert [i["line"] for i in preview["issues"]] == [2, 3]
        with_labels = head + b",outcome\n" + rows[0] + b",fraud\n"
        assert (
            await owner.post("/jury/trial/freeze", headers=CSV, content=with_labels)
        ).status_code == 422

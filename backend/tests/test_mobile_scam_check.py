from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.v1.scam_check import router
from app.integrations.guardian_education import ADVICE, QUESTIONS


async def test_mobile_and_telegram_share_the_same_educational_guide() -> None:
    app = FastAPI()
    app.include_router(router)
    async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
        response = await client.get("/scam-check/guide")
        submit = await client.post("/scam-check/guide", json={"text": "example"})
    assert submit.status_code == 405
    assert response.status_code == 200
    body = response.json()
    assert [(q["field"], q["ru"], q["kk"], q["caution_answer"]) for q in body["questions"]] == (
        QUESTIONS
    )
    assert (body["advice_ru"], body["advice_kk"]) == (ADVICE["ru"], ADVICE["kk"])

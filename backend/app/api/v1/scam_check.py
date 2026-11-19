"""Read-only mobile presentation of Guardian's educational questionnaire."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.integrations.guardian_education import ADVICE, QUESTIONS

router = APIRouter(prefix="/scam-check", tags=["scam-check"])


class GuideQuestion(BaseModel):
    field: str
    ru: str
    kk: str
    caution_answer: bool


class ScamGuide(BaseModel):
    questions: list[GuideQuestion]
    advice_ru: str
    advice_kk: str


@router.get("/guide", response_model=ScamGuide)
async def guide() -> ScamGuide:
    return ScamGuide(
        questions=[
            GuideQuestion(field=field, ru=ru, kk=kk, caution_answer=caution)
            for field, ru, kk, caution in QUESTIONS
        ],
        advice_ru=ADVICE["ru"],
        advice_kk=ADVICE["kk"],
    )

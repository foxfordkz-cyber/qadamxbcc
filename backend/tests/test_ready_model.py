import fakeredis
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.resources import Resources
from app.main import create_app
from app.ml.features import Features
from app.ml.model import Contributor, Prediction


@pytest.mark.parametrize("invalid", ["base", "contribution", "value"])
async def test_ready_rejects_nonfinite_explanations_even_with_finite_score(
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    invalid: str,
) -> None:
    redis = fakeredis.FakeAsyncRedis()
    settings = Settings()
    resources = Resources.build(settings, session_factory=session_factory, redis=redis)
    app = create_app(settings, resources)
    prediction = Prediction(
        score=10,
        base_score=float("nan") if invalid == "base" else 5,
        contributors=(
            Contributor(
                feature="amount_ratio",
                value=float("nan") if invalid == "value" else 1,
                contribution=float("inf") if invalid == "contribution" else 5,
                label_kk="Сома",
                label_ru="Сумма",
            ),
        ),
    )

    def substitute(_: Features) -> Prediction:
        return prediction

    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        monkeypatch.setattr(resources.engine.model, "score", substitute)
        response = await client.get("/ready")
        assert response.status_code == 503
        assert response.json() == {"detail": "Service dependencies are not ready"}
    await redis.aclose()

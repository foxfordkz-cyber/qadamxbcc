import asyncio, sys
from app.db.session import build_engine, build_session_factory
from app.integrations.config import get_integration_settings
from app.integrations.telegram.fake_adapter import FakeTelegramAdapter
from app.integrations.telegram.worker import deliver_one
async def main():
    engine = build_engine("sqlite+aiosqlite:///" + sys.argv[1]); f = build_session_factory(engine)
    for _ in range(40):
        print("delivered", await deliver_one(f, FakeTelegramAdapter(), get_integration_settings())); await asyncio.sleep(0.5)
    await engine.dispose()
asyncio.run(main())

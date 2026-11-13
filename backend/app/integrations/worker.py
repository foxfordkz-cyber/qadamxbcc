"""Separate process for bounded advisory orchestration and Telegram delivery."""

import argparse
import asyncio
import logging

from aiogram import Bot
from redis.asyncio import Redis

from app.core.config import get_settings
from app.db.session import build_engine, build_session_factory
from app.integrations.config import get_integration_settings
from app.integrations.nbk_mock.adapter import MockGatewayAdapter
from app.integrations.nbk_mock.client import GatewayClient
from app.integrations.observability import HEARTBEAT, configure_logging
from app.integrations.orchestrator import process_one
from app.integrations.telegram.adapter import AiogramTelegramAdapter, TelegramAdapter
from app.integrations.telegram.fake_adapter import FakeTelegramAdapter
from app.integrations.telegram.worker import deliver_one


async def run(*, once: bool = False, check_health: bool = False) -> None:
    cfg = get_integration_settings()
    if not cfg.enabled:
        return
    core = get_settings()
    redis: Redis = Redis.from_url(core.redis_url, socket_timeout=2, socket_connect_timeout=2)
    if check_health:
        try:
            if not await redis.get(HEARTBEAT):
                raise SystemExit(1)
        finally:
            await redis.aclose()
        return
    configure_logging()
    logger = logging.getLogger("bcc.integrations")
    engine = build_engine(core.database_url)
    factory = build_session_factory(engine)
    bot = Bot(cfg.telegram_token.get_secret_value()) if cfg.telegram_mode == "test" else None
    adapter: TelegramAdapter = (
        AiogramTelegramAdapter(bot, cfg.telegram_allowed_chat_ids) if bot else FakeTelegramAdapter()
    )
    client = GatewayClient(MockGatewayAdapter(), timeout=cfg.gateway_timeout_seconds)
    try:
        while True:
            try:
                async with asyncio.timeout(15):
                    await process_one(factory, redis, cfg, client)
                    await deliver_one(factory, adapter, cfg)
                    await redis.set(HEARTBEAT, "ok", ex=30)
            except Exception:
                logger.warning(
                    "worker dependency failure", extra={"event_code": "WORKER_DEPENDENCY_ERROR"}
                )
                if once:
                    raise SystemExit(1) from None
            if once:
                break
            await asyncio.sleep(0.5)
    finally:
        if bot:
            await bot.session.close()
        await redis.aclose()
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--health", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(once=args.once, check_health=args.health))

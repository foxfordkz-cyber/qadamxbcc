"""Run the password-protected Android demo with its own disposable data stores."""

import asyncio
import os
import secrets
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

import uvicorn
from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import build_engine, build_session_factory
from app.mobile_gateway.config import MobileSettings
from scripts.seed_bcc import seed


async def prepare() -> None:
    settings = get_settings()
    db = build_engine(settings.database_url)
    redis = Redis.from_url(settings.redis_url)
    try:
        for attempt in range(50):
            try:
                await redis.ping()
                break
            except RedisConnectionError:
                if attempt == 49:
                    raise
                await asyncio.sleep(0.1)
        # Fresh temporary DB on every process start. Persistent deployments use Alembic.
        async with db.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        await seed(
            build_session_factory(db), redis, n_background_accounts=48, n_background_transactions=60
        )
    finally:
        await redis.aclose()
        await db.dispose()


def main() -> None:
    with TemporaryDirectory(prefix="saq-mobile-") as folder:
        directory = Path(folder)
        socket = directory / "redis.sock"
        os.environ.update(
            BCC_ENVIRONMENT="demo",
            BCC_DATABASE_URL=f"sqlite+aiosqlite:///{directory / 'mobile.db'}",
            BCC_REDIS_URL=f"unix://{socket}",
            BCC_MOBILE_ENABLED="true",
            BCC_MOBILE_AUTH_MODE="password",
            BCC_MOBILE_EPHEMERAL_STORE="true",
            BCC_RENDER_TELEGRAM_TEST="false",
            BCC_INTEGRATIONS_ENABLED="true",
            BCC_INTEGRATIONS_ENVIRONMENT="test",
            BCC_INTEGRATIONS_SIGNING_KEY=secrets.token_hex(32),
            BCC_INTEGRATIONS_TELEGRAM_MODE="fake",
            BCC_INTEGRATIONS_TELEGRAM_TOKEN="",
            BCC_INTEGRATIONS_CIRCLE_WEB_OWNERS="{}",
        )
        MobileSettings()  # Require two provisioned role-specific scrypt hashes before startup.
        get_settings.cache_clear()
        with subprocess.Popen(
            [
                "redis-server",
                "--port",
                "0",
                "--unixsocket",
                str(socket),
                "--unixsocketperm",
                "700",
                "--dir",
                folder,
                "--save",
                "",
                "--appendonly",
                "no",
                "--maxmemory",
                "32mb",
                "--maxmemory-policy",
                "noeviction",
            ]
        ) as redis_server:
            try:
                asyncio.run(prepare())
                uvicorn.run(
                    "app.mobile_gateway.app:factory",
                    factory=True,
                    host="0.0.0.0",
                    port=int(os.environ.get("PORT", "8000")),
                    access_log=False,
                )
            finally:
                redis_server.terminate()


if __name__ == "__main__":
    main()

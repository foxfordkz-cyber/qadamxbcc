"""Run an isolated synthetic wallet for each jury room in one ephemeral process."""

import asyncio
import os
import secrets
import subprocess
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import (
    AbstractAsyncContextManager,
    AsyncExitStack,
    asynccontextmanager,
    contextmanager,
)
from pathlib import Path
from tempfile import TemporaryDirectory

import uvicorn
from fastapi import FastAPI
from pydantic import SecretStr
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import Settings, get_settings
from app.core.resources import Resources
from app.db.base import Base
from app.db.session import build_engine, build_session_factory
from app.integrations.config import IntegrationSettings, get_integration_settings
from app.mobile_gateway.config import MobileSettings
from scripts.handoff_data import populate
from scripts.seed_bcc import seed


class JuryStorage:
    """SQL and graph belong to one lease. Redis DB 0 is reserved for health checks."""

    def __init__(
        self, directory: Path, redis_for_slot: Callable[[int], Redis], mobile: MobileSettings
    ) -> None:
        self.directory = directory
        self.redis_for_slot = redis_for_slot
        self.mobile = mobile
        self.active: set[int] = set()
        self.provisioning = asyncio.Semaphore(1)

    def history_room(self, slot: int) -> AbstractAsyncContextManager[FastAPI]:
        return self.room(slot, with_history=True)

    @asynccontextmanager
    async def room(self, slot: int, *, with_history: bool = False) -> AsyncIterator[FastAPI]:
        from app.mobile_gateway.app import create_mobile_app
        from app.mobile_gateway.dispute_receipts import install_dispute_receipts
        from app.mobile_gateway.jury_contact import install_jury_contact
        from app.mobile_gateway.partner_signal import install_partner_signal

        if not 1 <= slot <= 8 or slot in self.active:
            raise ValueError("Invalid or active jury slot")
        self.active.add(slot)
        try:
            async with AsyncExitStack() as stack:
                folder = stack.enter_context(
                    TemporaryDirectory(dir=self.directory, prefix=f"room-{slot}-")
                )
                settings = Settings(
                    environment="demo",
                    database_url="sqlite+aiosqlite:///" + (Path(folder) / "wallet.db").as_posix(),
                    api_key=SecretStr(secrets.token_urlsafe(32)),
                    soc_api_key=SecretStr(secrets.token_urlsafe(32)),
                    render_telegram_test=False,
                )
                db = build_engine(settings.database_url)
                stack.push_async_callback(db.dispose)
                sessions = build_session_factory(db)
                redis = self.redis_for_slot(slot)
                stack.push_async_callback(redis.aclose)
                # Even a failed previous teardown cannot carry a token into this lease.
                await redis.flushdb()
                stack.push_async_callback(redis.flushdb)
                async with self.provisioning:
                    async with db.begin() as connection:
                        await connection.run_sync(Base.metadata.create_all)
                    # The seeded hub's fan-in window expires: seed relative to each new lease.
                    await seed(
                        sessions, redis, n_background_accounts=48, n_background_transactions=60
                    )
                    resources = Resources.build(settings, session_factory=sessions, redis=redis)
                    integration = IntegrationSettings(
                        enabled=True,
                        environment="test",
                        signing_key=SecretStr(secrets.token_urlsafe(32)),
                        telegram_mode="fake",
                        telegram_token=SecretStr(""),
                        telegram_allowed_chat_ids=[],
                        circle_web_owners={},
                    )
                    hostname = os.getenv("RENDER_EXTERNAL_HOSTNAME")
                    origin = os.getenv("BCC_JURY_PUBLIC_ORIGIN") or (
                        f"https://{hostname}" if hostname else "http://localhost:18003"
                    )
                    app = create_mobile_app(
                        self.mobile,
                        settings,
                        resources,
                        integration,
                        browser_only=True,
                        transfer_key_origin=origin,
                    )
                    await install_jury_contact(app, sessions, integration, self.mobile.customer_id)
                    install_partner_signal(app)
                    install_dispute_receipts(app, self.mobile.customer_id)
                    if with_history:
                        # Populate only this new private SQLite lease; the contact
                        # already occupies its slot and startup will replay the graph.
                        async with sessions() as session:
                            await populate(session, review_engine=resources.engine)
                            await session.commit()
                    await stack.enter_async_context(app.router.lifespan_context(app))
                yield app
        finally:
            self.active.remove(slot)


async def serve(directory: Path, socket: Path, mobile: MobileSettings) -> None:
    from app.mobile_gateway.jury_rooms import create_jury_app

    def redis_for_slot(slot: int) -> Redis:
        return Redis(unix_socket_path=str(socket), db=slot, socket_connect_timeout=2)

    async with redis_for_slot(0) as health:
        for attempt in range(50):
            try:
                await health.ping()
                break
            except RedisError:
                if attempt == 49:
                    raise
                await asyncio.sleep(0.1)

        async def ready() -> bool:
            async with asyncio.timeout(2):
                return bool(await health.ping())

        storage = JuryStorage(directory, redis_for_slot, mobile)
        # Fail startup on broken credentials, DB, graph, model, or seed before offering a room.
        async with storage.room(1):
            pass
        app = create_jury_app(storage.room, history_factory=storage.history_room, ready=ready)
        await uvicorn.Server(
            uvicorn.Config(
                app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), access_log=False
            )
        ).serve()


@contextmanager
def private_redis(directory: Path) -> Iterator[Path]:
    socket = directory / "redis.sock"
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
            str(directory),
            "--save",
            "",
            "--appendonly",
            "no",
            "--databases",
            "9",
            "--maxmemory",
            "32mb",
            "--maxmemory-policy",
            "noeviction",
        ]
    ) as redis_server:
        try:
            yield socket
        finally:
            redis_server.terminate()


def main() -> None:
    os.environ.update(
        BCC_ENVIRONMENT="demo",
        BCC_RENDER_TELEGRAM_TEST="false",
        BCC_INTEGRATIONS_ENABLED="false",
        BCC_INTEGRATIONS_ENVIRONMENT="test",
        BCC_INTEGRATIONS_TELEGRAM_MODE="fake",
        BCC_INTEGRATIONS_TELEGRAM_TOKEN="",
        BCC_INTEGRATIONS_TELEGRAM_ALLOWED_CHAT_IDS="[]",
        BCC_INTEGRATIONS_CIRCLE_WEB_OWNERS="{}",
    )
    get_settings.cache_clear()
    get_integration_settings.cache_clear()
    mobile = MobileSettings(
        enabled=True,
        auth_mode="password",
        ephemeral_store=True,
        telegram_username="",
        cors_origins=[],
    )
    if not mobile.platform_hash.get_secret_value():
        raise ValueError("Three separate jury login hashes are required")
    with TemporaryDirectory(prefix="saq-jury-") as folder:
        directory = Path(folder)
        with private_redis(directory) as socket:
            asyncio.run(serve(directory, socket, mobile))


if __name__ == "__main__":
    main()

"""Start only the authenticated mobile boundary on a hosted synthetic stand."""

import os

import uvicorn
from alembic import command
from alembic.config import Config

from app.mobile_gateway.config import MobileSettings


def main() -> None:
    cfg = MobileSettings()
    if not cfg.enabled or cfg.auth_mode != "password":
        raise SystemExit("Hosted demo requires two provisioned accounts")
    command.upgrade(Config("alembic.ini"), "heads")
    import asyncio

    from scripts.bootstrap_demo import main as bootstrap

    asyncio.run(bootstrap())
    uvicorn.run(
        "app.mobile_gateway.app:factory",
        factory=True,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "18001")),
        access_log=False,
    )


if __name__ == "__main__":
    main()

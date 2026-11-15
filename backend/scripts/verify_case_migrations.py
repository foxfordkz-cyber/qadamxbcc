"""Destructive round trip restricted to explicitly named disposable test databases."""

import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url


def verify() -> None:
    url = os.environ["BCC_TEST_DATABASE_URL"]
    if not (make_url(url).database or "").startswith("bcc_integration_test"):
        raise RuntimeError("migration round trip requires bcc_integration_test database")
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    command.upgrade(config, "0006_guardian_reports")
    command.upgrade(config, "head")
    command.check(config)
    command.downgrade(config, "0006_guardian_reports")
    command.upgrade(config, "head")
    command.check(config)
    print("PASS: Guardian 2 to Guardian 3, downgrade, upgrade and ORM parity")


if __name__ == "__main__":
    verify()

"""Start the synthetic Android gateway with fresh, locally stored role access codes.

Requires an already migrated and seeded isolated test database. Credentials are never
printed. The owner reads the access file locally; do not paste it into chat or commit it.
"""

import json
import os
import secrets
import subprocess
import sys
from pathlib import Path

import uvicorn

from app.mobile_gateway.passwords import encode


def protect(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name == "nt":
        user = subprocess.run(["whoami"], capture_output=True, text=True, check=True).stdout.strip()
        subprocess.run(
            [
                "icacls",
                str(directory),
                "/inheritance:r",
                "/grant:r",
                f"{user}:(OI)(CI)F",
                "SYSTEM:(OI)(CI)F",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
    else:
        directory.chmod(0o700)


def main() -> None:
    # This runner never configures or starts real Telegram.
    if os.environ.get("BCC_ENVIRONMENT", "local") not in {"local", "demo"}:
        raise SystemExit("Synthetic mobile demo cannot run in pilot")
    directory = Path(
        os.environ.get(
            "BCC_MOBILE_ACCESS_DIR",
            str(Path(__file__).resolve().parents[2] / ".local-checks" / "mobile-access"),
        )
    ).resolve()
    protect(directory)
    access = {"client": secrets.token_urlsafe(24), "admin": secrets.token_urlsafe(24)}
    path = directory / "access.json"
    fd = os.open(path, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(access, handle)
    os.environ.update(
        {
            "BCC_MOBILE_ENABLED": "true",
            "BCC_MOBILE_AUTH_MODE": os.environ.get("BCC_MOBILE_AUTH_MODE", "password"),
            "BCC_MOBILE_CLIENT_HASH": encode(access["client"]),
            "BCC_MOBILE_ADMIN_HASH": encode(access["admin"]),
            "BCC_MOBILE_CLIENT_CODE": access["client"],
            "BCC_MOBILE_ADMIN_CODE": access["admin"],
            "BCC_INTEGRATIONS_ENABLED": "true",
            "BCC_INTEGRATIONS_ENVIRONMENT": "test",
            "BCC_INTEGRATIONS_TELEGRAM_MODE": "fake",
            "BCC_INTEGRATIONS_SIGNING_KEY": secrets.token_hex(32),
        }
    )
    print(f"Protected local access file: {path}", flush=True)
    print("Synthetic gateway only; real Telegram disabled.", flush=True)
    # Bind loopback by default. A deliberate --lan flag is needed for a physical phone.
    uvicorn.run(
        "app.mobile_gateway.app:factory",
        factory=True,
        host="0.0.0.0" if "--lan" in sys.argv else "127.0.0.1",
        port=18001,
        access_log=False,
    )


if __name__ == "__main__":
    main()

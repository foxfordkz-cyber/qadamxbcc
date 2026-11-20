"""Provision both synthetic demo logins once; write individual ACL-protected handoff files."""

import json
import os
import secrets
from pathlib import Path

from scripts.mobile_demo import protect


def provision(directory: Path) -> None:
    protect(directory)
    for name in ("client_demo", "admin_demo"):
        path = directory / (name + ".json")
        if not path.exists():
            password = secrets.token_urlsafe(12)
            with path.open("x", encoding="utf-8") as output:
                json.dump({"login": name, "password": password}, output)
            if os.name != "nt":
                path.chmod(0o600)


if __name__ == "__main__":
    provision(Path(os.environ["QADAM_PRIVATE_DIR"]))

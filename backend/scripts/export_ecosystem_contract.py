"""Check or refresh the OpenAPI subset consumed by the shared wallet ecosystem."""

import argparse
import json
from pathlib import Path
from typing import Any

from pydantic import SecretStr

from app.core.config import Settings
from app.main import create_app
from app.mobile_gateway.app import create_mobile_app
from app.mobile_gateway.config import MobileSettings

OUTPUT = Path(__file__).resolve().parents[2] / "docs/contracts/ECOSYSTEM_OPENAPI.json"
CORE = (
    "/api/v1/transfers/evaluate",
    "/api/v1/transfers/{transaction_id}",
    "/api/v1/transfers/{transaction_id}/resolve-cooling",
    "/api/v1/trusted-contacts",
    "/api/v1/integrations/guardian/reports",
    "/api/v1/integrations/guardian/soc/cases",
    "/api/v1/integrations/guardian/soc/cases/{case_id}/actions",
    "/api/v1/integrations/soc/transactions/{transaction_id}/timeline",
    "/api/v1/integrations/health/details",
    "/api/v1/soc/feed",
)
MOBILE = (
    "/mobile/v1/compatibility",
    "/mobile/v1/account",
    "/mobile/v1/auth/login",
    "/mobile/v1/session",
    "/mobile/v1/requests",
    "/mobile/v1/wallet/operations",
    "/mobile/v1/wallet/soc",
    "/mobile/v1/wallet/cases",
    "/mobile/v1/admin/staff",
    "/mobile/v1/admin/metrics",
)


def subset(schema: dict[str, Any], paths: tuple[str, ...]) -> dict[str, Any]:
    missing = set(paths) - schema["paths"].keys()
    if missing:
        raise ValueError("Contract routes missing: " + ", ".join(sorted(missing)))
    selected = {path: schema["paths"][path] for path in paths}
    models: dict[str, Any] = {}

    def references(value: Any) -> None:
        if isinstance(value, dict):
            ref = value.get("$ref", "")
            if ref.startswith("#/components/schemas/"):
                name = ref.split("/")[-1]
                if name not in models:
                    models[name] = schema["components"]["schemas"][name]
                    references(models[name])
            for item in value.values():
                references(item)
        elif isinstance(value, list):
            for item in value:
                references(item)

    references(selected)
    return {"paths": selected, "components": {"schemas": models}}


def render() -> str:
    settings = Settings(environment="demo", database_url="sqlite+aiosqlite:///:memory:")
    config = MobileSettings(
        enabled=True,
        client_code=SecretStr("contract-client-ABCDEF1234567890"),
        admin_code=SecretStr("contract-officer-ZYXWVU0987654321"),
    )
    payload = {
        "api_major": 1,
        "core": subset(create_app(settings).openapi(), CORE),
        "mobile": subset(create_mobile_app(config, settings).openapi(), MOBILE),
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = render()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != expected:
            raise SystemExit(
                "Ecosystem contract changed: review compatibility, then regenerate snapshot"
            )
        print("OpenAPI ecosystem contract: PASS")
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(expected, encoding="utf-8")
        print("Refreshed docs/contracts/ECOSYSTEM_OPENAPI.json")


if __name__ == "__main__":
    main()

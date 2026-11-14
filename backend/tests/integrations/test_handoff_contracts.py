import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.routing import APIRoute
from pydantic import TypeAdapter

from app.api.v1 import external_checks, integrations, trusted_contacts
from app.main import create_app

DOCS = Path(__file__).resolve().parents[3] / "docs" / "integrations"
EXAMPLES = json.loads((DOCS / "api_examples.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("example", EXAMPLES, ids=lambda e: f"{e['method']} {e['path']}")
def test_frontend_examples_match_published_routes(example: dict[str, Any]) -> None:
    app = create_app()
    routes = [
        r
        for module in (trusted_contacts, external_checks, integrations)
        for r in module.router.routes
    ]
    route = next(
        route
        for route in routes
        if isinstance(route, APIRoute)
        and route.path == example["path"].removeprefix("/api/v1")
        and example["method"] in (route.methods or set())
    )
    assert example["method"].lower() in app.openapi()["paths"][example["path"]]
    assert (route.status_code or 200) == example["status"]
    if example["request"] is not None:
        assert route.body_field
        _, errors = route.body_field.validate(example["request"], {})
        assert not errors
    adapter = TypeAdapter(route.response_model)
    parsed = adapter.validate_python(example["response"])
    assert adapter.dump_python(parsed, mode="json") == example["response"]


def test_openapi_export_matches_current_application() -> None:
    assert json.loads((DOCS / "openapi.json").read_text(encoding="utf-8")) == create_app().openapi()

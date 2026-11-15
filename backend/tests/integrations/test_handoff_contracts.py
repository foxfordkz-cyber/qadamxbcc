import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.routing import APIRoute
from pydantic import TypeAdapter

from app.api.v1 import (
    external_checks,
    guardian_reports,
    integration_insights,
    integrations,
    trusted_contacts,
)
from app.main import create_app

DOCS = Path(__file__).resolve().parents[3] / "docs" / "integrations"
EXAMPLES = json.loads((DOCS / "api_examples.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("example", EXAMPLES, ids=lambda e: f"{e['method']} {e['path']}")
def test_frontend_examples_match_published_routes(example: dict[str, Any]) -> None:
    app = create_app()
    routes = {
        (method, prefix + route.path): route
        for module, prefix in [
            (trusted_contacts, "/api/v1"),
            (external_checks, "/api/v1"),
            (integrations, "/api/v1"),
            (integration_insights, "/api/v1/integrations"),
            (guardian_reports, "/api/v1/integrations"),
        ]
        for route in module.router.routes
        if isinstance(route, APIRoute)
        for method in (route.methods or set())
    }
    route = routes[(example["method"], example["path"])]
    assert example["method"].lower() in app.openapi()["paths"][example["path"]]
    assert (route.status_code or 200) == example["status"]
    if example["request"] is not None:
        assert route.body_field
        _, errors = route.body_field.validate(example["request"], {})
        assert not errors
    for field in route.dependant.query_params:
        value = example.get("query_parameters", {}).get(field.name, field.default)
        _, errors = field.validate(value, {})
        assert not errors
    adapter = TypeAdapter(route.response_model)
    parsed = adapter.validate_python(example["response"])
    assert adapter.dump_python(parsed, mode="json") == example["response"]


def test_openapi_export_matches_current_application() -> None:
    assert json.loads((DOCS / "openapi.json").read_text(encoding="utf-8")) == create_app().openapi()

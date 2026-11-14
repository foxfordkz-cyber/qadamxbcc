"""Refresh checked frontend examples, OpenAPI and bilingual insight labels."""

import json
from pathlib import Path

from fastapi.routing import APIRoute
from pydantic import TypeAdapter

from app.api.v1 import external_checks, integration_insights, integrations, trusted_contacts
from app.integrations.timeline import LABELS
from app.main import create_app

DOCS = Path(__file__).resolve().parents[2] / "docs/integrations"


def export() -> None:
    examples = json.loads((DOCS / "api_examples.json").read_text(encoding="utf-8"))
    timestamp = "2026-11-14T09:00:00Z"
    tx = "00000000-0000-4000-8000-000000000002"
    additions = {
        "/api/v1/integrations/soc/transactions/{transaction_id}/timeline": {
            "transaction_id": tx,
            "as_of": timestamp,
            "events": [
                {
                    "id": "core:0:00000000000040008000000000000002",
                    "timestamp": timestamp,
                    "category": "core",
                    "importance": "information",
                    "code": "TRANSFER_EVALUATED",
                    "correlation_id": None,
                    "description_ru": LABELS["TRANSFER_EVALUATED"][2],
                    "description_kk": LABELS["TRANSFER_EVALUATED"][3],
                    "source": "persisted_core",
                }
            ],
            "next_cursor": None,
            "advisory_only": True,
        },
        "/api/v1/integrations/health/details": {
            "status": "ok",
            "checked_at": timestamp,
            "cache_seconds": 5,
            "database": "ok",
            "redis": "ok",
            "worker": "ok",
            "telegram": "fake_enabled",
            "gateway": "mock_ready",
            "queue": {
                "notifications_queued": 1,
                "notifications_delayed": 1,
                "notifications_failed": 0,
                "runs_pending": 0,
            },
            "last_successful_processing": timestamp,
            "real_provider_probed": False,
        },
    }
    examples = [e for e in examples if e["path"] not in additions]
    for path, response in additions.items():
        examples.append(
            {
                "method": "GET",
                "path": path,
                "role": "soc",
                "headers": {"Authorization": "Bearer <operator-issued-soc-capability>"},
                "path_parameters": {"transaction_id": tx},
                "query_parameters": {"limit": 50} if path.endswith("timeline") else {},
                "request": None,
                "status": 200,
                "response": response,
            }
        )
    routes = {
        (method, prefix + route.path): route
        for module, prefix in [
            (trusted_contacts, "/api/v1"),
            (external_checks, "/api/v1"),
            (integrations, "/api/v1"),
            (integration_insights, "/api/v1/integrations"),
        ]
        for route in module.router.routes
        if isinstance(route, APIRoute)
        for method in (route.methods or set())
    }
    for example in examples:
        route = routes[(example["method"], example["path"])]
        adapter = TypeAdapter(route.response_model)
        example["response"] = adapter.dump_python(
            adapter.validate_python(example["response"]), mode="json"
        )
    for name, value in [("api_examples.json", examples), ("openapi.json", create_app().openapi())]:
        (DOCS / name).write_text(
            json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    texts = json.loads((DOCS / "ui_texts.json").read_text(encoding="utf-8"))
    texts["timeline"] = {code: {"ru": label[2], "kk": label[3]} for code, label in LABELS.items()}
    texts["health"] = {
        "ok": {"ru": "Работает", "kk": "Жұмыс істеп тұр"},
        "degraded": {"ru": "Есть ограничения", "kk": "Шектеулер бар"},
        "unavailable": {"ru": "Недоступно", "kk": "Қолжетімсіз"},
        "not_seen": {"ru": "Worker не наблюдается", "kk": "Worker байқалмайды"},
        "unknown": {"ru": "Неизвестно", "kk": "Белгісіз"},
        "mock_ready": {"ru": "Готов синтетический MOCK", "kk": "Синтетикалық MOCK дайын"},
        "disabled": {"ru": "Отключено", "kk": "Өшірілген"},
        "fake_enabled": {"ru": "Включён Fake Adapter", "kk": "Fake Adapter қосулы"},
        "test_enabled": {"ru": "Включён тестовый Telegram", "kk": "Тестілік Telegram қосулы"},
    }
    (DOCS / "ui_texts.json").write_text(
        json.dumps(texts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Exported {len(examples)} typed examples and OpenAPI")


if __name__ == "__main__":
    export()

"""Extend the canonical, validated integration fixture bundle; no duplicate SDK."""

import json

from scripts.export_case_contracts import case_examples
from scripts.export_integration_contracts import DOCS


def operations_examples() -> None:
    root = "/api/v1/integrations"
    stamp = "2026-11-15T09:00:00Z"
    identifier = "00000000-0000-4000-8000-000000000020"
    specs = {
        "/soc/operations/notifications": (
            "soc",
            {
                "as_of": stamp,
                "items": [
                    {
                        "id": identifier,
                        "correlation_id": identifier,
                        "state": "DELIVERY_FAILED",
                        "disposition": "retry_exhausted",
                        "attempts": 3,
                        "created_at": stamp,
                        "expires_at": "2026-11-15T09:10:00Z",
                        "next_attempt_at": None,
                        "processing_age_seconds": None,
                        "queue_age_seconds": 0.0,
                        "error_code": "retry_exhausted",
                        "retry_scheduled": False,
                        "manual_resend_supported": False,
                    }
                ],
                "next_after_id": None,
            },
        ),
        "/soc/operations/queue": (
            "soc",
            {
                "as_of": stamp,
                "by_state": {"DELIVERY_FAILED": 1},
                "processing": 0,
                "oldest_processing_age_seconds": None,
                "oldest_queued_age_seconds": None,
                "retry_exhausted": 1,
                "ambiguous_delivery": 0,
            },
        ),
        "/privacy/permissions": (
            "owner",
            {
                "exported_at": stamp,
                "permissions": [
                    {
                        "contact_id": identifier,
                        "state": "CONTACT_REVOKED",
                        "language": "kk",
                        "notifications_enabled": False,
                        "owner_consented_at": stamp,
                        "last_contact_consent_at": stamp,
                        "consent_currently_valid": False,
                        "delivery_identifiers_erased": True,
                    }
                ],
                "next_after_id": None,
                "active_contact_limit": 3,
                "recipients_per_notification": 1,
                "retention_policy": (
                    "personal_fields_until_revoke_metadata_until_demo_database_removal"
                ),
            },
        ),
        "/privacy/contacts/{contact_id}/history": (
            "owner",
            {
                "events": [{"id": identifier, "event": "CONTACT_REVOKED", "created_at": stamp}],
                "next_after_id": None,
            },
        ),
    }
    examples = json.loads((DOCS / "api_examples.json").read_text(encoding="utf-8"))
    examples = [e for e in examples if e["path"] not in {root + p for p in specs}]
    for path, (role, response) in specs.items():
        examples.append(
            {
                "method": "GET",
                "path": root + path,
                "role": role,
                "headers": {"Authorization": f"Bearer <operator-issued-{role}-capability>"},
                "path_parameters": {"contact_id": identifier},
                "query_parameters": {},
                "request": None,
                "status": 200,
                "response": response,
            }
        )
    (DOCS / "api_examples.json").write_text(
        json.dumps(examples, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    case_examples()
    texts = json.loads((DOCS / "ui_texts.json").read_text(encoding="utf-8"))
    texts["operation_dispositions"] = {
        "queued": {"ru": "В очереди", "kk": "Кезекте"},
        "delayed": {"ru": "Ожидает разрешённой попытки", "kk": "Рұқсат етілген әрекетті күтуде"},
        "processing": {"ru": "Обрабатывается", "kk": "Өңделуде"},
        "ambiguous": {
            "ru": "Результат неизвестен; не повторять",
            "kk": "Нәтиже белгісіз; қайталамаңыз",
        },
        "retry_exhausted": {"ru": "Попытки исчерпаны", "kk": "Әрекет саны аяқталды"},
        "terminal": {"ru": "Обработка завершена", "kk": "Өңдеу аяқталды"},
    }
    (DOCS / "ui_texts.json").write_text(
        json.dumps(texts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    operations_examples()

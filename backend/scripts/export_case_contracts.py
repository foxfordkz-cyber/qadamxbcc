"""Generate synthetic case examples using the existing OpenAPI/contract pipeline."""

import json

from app.integrations.cases.schemas import LABELS, QUESTIONS
from scripts.export_integration_contracts import DOCS, export


def case_examples() -> None:
    root = "/api/v1/integrations/guardian"
    cases = root + "/soc/cases"
    stamp = "2026-11-15T09:00:00Z"
    cid = "00000000-0000-4000-8000-000000000010"
    rid = "00000000-0000-4000-8000-000000000011"
    eid = "00000000-0000-4000-8000-000000000012"
    row = {
        "id": cid,
        "report_id": rid,
        "source": "owner_demo",
        "category": "impersonation",
        "state": "NEW",
        "assignee": None,
        "version": 1,
        "created_at": stamp,
        "status_since": stamp,
        "expires_at": "2026-12-15T09:00:00Z",
        "demonstration_only": True,
    }
    event = {
        "id": eid,
        "actor_id": "00000000-0000-4000-8000-000000000014",
        "category": "impersonation",
        "assignee": None,
        "reason": None,
        "version": 1,
        "code": "OPENED",
        "actor_role": "soc",
        "timestamp": stamp,
        "state": "NEW",
        "description_ru": LABELS["OPENED"][0],
        "description_kk": LABELS["OPENED"][1],
    }
    info = {
        "id": eid,
        "question": "caller_request",
        "description_ru": QUESTIONS["caller_request"][0],
        "description_kk": QUESTIONS["caller_request"][1],
        "created_at": stamp,
        "answered": False,
    }
    examples = json.loads((DOCS / "api_examples.json").read_text(encoding="utf-8"))
    specs = [
        ("POST", cases, {"report_id": rid}, row, 201, "soc"),
        ("GET", cases, None, {"items": [row], "next_cursor": None}, 200, "soc"),
        (
            "GET",
            cases + "/analytics",
            None,
            {
                "as_of": stamp,
                "total": 1,
                "open": 1,
                "closed": 0,
                "by_state": {"NEW": 1},
                "by_source": {"owner_demo": 1},
                "escalated_cases": 0,
                "manually_reviewed_cases": 0,
                "manual_review_share": 0.0,
                "oldest_current_status_seconds": {"NEW": 0.0},
                "demonstration_only": True,
            },
            200,
            "soc",
        ),
        ("GET", cases + "/{case_id}", None, row, 200, "soc"),
        (
            "POST",
            cases + "/{case_id}/actions",
            {"action": "assign", "expected_version": 1, "assignee": "demo_analyst_a"},
            {**row, "version": 2, "assignee": "demo_analyst_a"},
            200,
            "soc",
        ),
        (
            "GET",
            cases + "/{case_id}/history",
            None,
            {"items": [event], "next_after_version": None},
            200,
            "soc",
        ),
        (
            "GET",
            cases + "/{case_id}/notes",
            None,
            {"items": [], "next_after_version": None},
            200,
            "soc",
        ),
        (
            "GET",
            cases + "/{case_id}/evidence",
            None,
            {
                "report_available": True,
                "transaction_id": None,
                "report_events": [],
                "advisory_only": True,
            },
            200,
            "soc",
        ),
        (
            "GET",
            cases + "/{case_id}/export",
            None,
            {
                "category": "impersonation",
                "state": "NEW",
                "source": "owner_demo",
                "created_at": stamp,
                "events": [{"code": "OPENED", "state": "NEW", "timestamp": stamp}],
                "demonstration_only": True,
            },
            200,
            "soc",
        ),
        ("GET", root + "/reports/{report_id}/information-requests", None, [info], 200, "owner"),
        (
            "POST",
            root + "/reports/{report_id}/information-requests/{request_id}",
            {
                "body": "Synthetic caller requested remote access software.",
                "confirmed_demo_submission": True,
            },
            {"request_id": eid, "received": True},
            200,
            "owner",
        ),
    ]
    paths = {path for _, path, *_ in specs}
    examples = [e for e in examples if e["path"] not in paths]
    for method, path, body, response, status, role in specs:
        headers = {"Authorization": f"Bearer <operator-issued-{role}-capability>"}
        if method == "POST":
            headers["Idempotency-Key"] = "00000000-0000-4000-8000-000000000013"
        examples.append(
            {
                "method": method,
                "path": path,
                "role": role,
                "headers": headers,
                "path_parameters": {"case_id": cid, "report_id": rid, "request_id": eid},
                "query_parameters": {},
                "request": body,
                "status": status,
                "response": response,
            }
        )
    (DOCS / "api_examples.json").write_text(
        json.dumps(examples, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    export()
    texts = json.loads((DOCS / "ui_texts.json").read_text(encoding="utf-8"))
    texts["case_events"] = {code: {"ru": ru, "kk": kk} for code, (ru, kk) in LABELS.items()}
    texts["case_questions"] = {code: {"ru": ru, "kk": kk} for code, (ru, kk) in QUESTIONS.items()}
    texts["case_states"] = {
        "NEW": {"ru": "Новое", "kk": "Жаңа"},
        "IN_REVIEW": {"ru": "На рассмотрении", "kk": "Қаралуда"},
        "NEEDS_INFORMATION": {"ru": "Нужно уточнение", "kk": "Нақтылау қажет"},
        "ESCALATED": {"ru": "Передано на углублённую проверку", "kk": "Терең тексеруге жіберілді"},
        "RESOLVED": {"ru": "Рассмотрение завершено (демо)", "kk": "Қарау аяқталды (демо)"},
        "CLOSED": {"ru": "Закрыто", "kk": "Жабылды"},
    }
    (DOCS / "ui_texts.json").write_text(
        json.dumps(texts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    case_examples()

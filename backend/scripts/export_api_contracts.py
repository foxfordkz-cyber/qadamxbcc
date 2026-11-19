# ruff: noqa: E501  (the Markdown header keeps table rows on one line)
"""Render docs/API_CONTRACTS.md from the application's own OpenAPI schema.

    uv run python -m scripts.export_api_contracts          # write the file
    uv run python -m scripts.export_api_contracts --check  # exit 1 if it is stale

The endpoint table is generated, so it cannot drift from the code; the rules above it
are the team agreement every client (app, SOC, bot) follows.
"""

import argparse
import sys
from pathlib import Path
from typing import Any

from app.main import create_app

DOC = Path(__file__).resolve().parents[2] / "docs" / "API_CONTRACTS.md"

HEADER = """# Saq Bol — контракты API

Этот файл сгенерирован из OpenAPI самого backend:
`uv run python -m scripts.export_api_contracts` (из `backend/`). Тест
`tests/test_api_contracts_doc.py` падает, если код изменился, а файл нет.
Полная схема: [`docs/integrations/openapi.json`](integrations/openapi.json).

## Правила для всех клиентов

| Правило | Что значит |
|---|---|
| Ключи только на сервере | `X-BCC-API-Key`, `X-BCC-SOC-Key` и Bearer-токены интеграций добавляет серверный маршрут Next.js (`frontend/src/app/api/v1/...`). В браузерном коде, `localStorage` и URL их нет: проверено сборкой с ключами-маячками 19 ноября. |
| Идемпотентность | `POST /transfers/evaluate` с тем же `request_id` возвращает сохранённое решение; другой payload с тем же `request_id` — `409`. Интеграции принимают заголовок `Idempotency-Key`. |
| Деньги решает только ядро | Telegram-контакт, Scam Check и интеграции — advisory: они не меняют статус перевода напрямую. |
| Удержание | Срок удержания приходит из `cooling_off_until` сервера; клиент не считает его сам. Отпустить перевод раньше срока нельзя. |
| Опрос | Не чаще раза в 2,1 с из одного места; на `429` ждать `Retry-After`. |
| Конфликт версии кейса | `409 case_version_conflict`: перечитать кейс, оператор подтверждает действие заново. |
| `RESOLVED` | Не означает «деньги возвращены». |
| Пометки | Ответы имитаций помечены `MOCK` / `simulated_log`; интерфейс показывает это явно. |

## Доступ

| Заголовок | Кто держит | Для чего |
|---|---|---|
| `X-BCC-API-Key` | серверный маршрут клиентского приложения | переводы, «Банк мне звонит?» |
| `X-BCC-SOC-Key` | серверный маршрут SOC | лента SOC, граф, `/ready` |
| `Authorization: Bearer <token>` | серверные маршруты, роли `owner`, `soc`, `simulator` | доверенный круг, интеграции, кейсы SOC; токен выдаёт `scripts.integration_token` |

Без настроенного ключа в режиме `local`/`demo` доступ открыт; в `pilot` без ключа сервис
отвечает `503`. Неверный ключ — `401`.

## Ошибки

| Код | Когда | Тело |
|---|---|---|
| `401` | нет или неверный ключ/токен | `{"detail": "..."}` |
| `404` | нет записи; демо-управление вне демо | `{"detail": "..."}` |
| `409` | повтор `request_id` с другим телом; повторный ответ на анкету; конфликт версии кейса | `{"detail": "..."}` |
| `413` | тело больше `BCC_MAX_REQUEST_BYTES` (16 КБ по умолчанию) | `{"detail": "..."}` |
| `422` | невалидный запрос (Pydantic) | `{"detail": [...]}` |
| `429` | превышен `BCC_REQUEST_RATE_LIMIT_PER_MINUTE` (120 по умолчанию) | заголовок `Retry-After` |
| `503` | зависимость недоступна; история счёта сверх ёмкости скоринга (fail-closed) | заголовок `Retry-After: 60` |

Интеграции отвечают `{"detail": "<код>"}` с кодом из `app/integrations/errors.py`.
Прокси Next.js переводит ответы в `{"error": "notFound" | "conflict" | "invalid" |
"requestTooLarge" | "rateLimited" | "apiError"}` для браузера.

## Эндпоинты
"""


def _ref(schema: dict[str, Any] | None) -> str:
    if not schema:
        return "—"
    if "$ref" in schema:
        return f"`{schema['$ref'].rsplit('/', 1)[-1]}`"
    if schema.get("type") == "array" and "items" in schema:
        return f"список {_ref(schema['items'])}"
    if "anyOf" in schema:
        return " / ".join(_ref(s) for s in schema["anyOf"] if s.get("type") != "null")
    return f"`{schema.get('type', 'object')}`"


def _access(op: dict[str, Any]) -> str:
    headers = [p["name"] for p in op.get("parameters", []) if p["in"] == "header"]
    keys = [h for h in headers if h.startswith("X-BCC-")]
    if keys:
        return ", ".join(f"`{k}`" for k in keys)
    if op.get("security"):
        return "Bearer"
    return "—"


def render() -> str:
    schema = create_app().openapi()
    groups: dict[str, list[str]] = {}
    for path, ops in schema["paths"].items():
        for method, op in ops.items():
            body = op.get("requestBody", {}).get("content", {}).get("application/json", {})
            ok = next((c for c in ("200", "201", "202") if c in op.get("responses", {})), None)
            resp = (
                op["responses"][ok].get("content", {}).get("application/json", {}).get("schema")
                if ok
                else None
            )
            codes = ", ".join(sorted(op.get("responses", {})))
            idem = any(p["name"].lower() == "idempotency-key" for p in op.get("parameters", []))
            row = (
                f"| `{method.upper()}` | `{path}` | {_access(op)}"
                f"{' + Idempotency-Key' if idem else ''} | {_ref(body.get('schema'))} | "
                f"{_ref(resp)} | {codes} |"
            )
            groups.setdefault((op.get("tags") or ["other"])[-1], []).append(row)
    out = [HEADER]
    for tag, rows in groups.items():
        out.append(f"\n### {tag}\n")
        out.append("| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |")
        out.append("|---|---|---|---|---|---|")
        out.extend(rows)
    out.append(
        "\nКоды `401`, `413`, `429`, `503` из раздела «Ошибки» относятся ко всем путям"
        " `/api/v1` и в схеме отдельно не перечислены.\n"
    )
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    text = render()
    if args.check:
        current = DOC.read_text(encoding="utf-8") if DOC.exists() else ""
        if current != text:
            sys.exit(f"{DOC} is stale: run python -m scripts.export_api_contracts")
        return
    DOC.write_text(text, encoding="utf-8")
    print(f"Wrote {DOC}")


if __name__ == "__main__":
    main()

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
Живые `/openapi.json` и `/docs` backend отражают запущенную версию; экспорт
обновляется командой `uv run python -m scripts.export_integration_contracts`.

## Где искать точный контракт

- Ядро переводов, анкета, отмена, call-check и SOC: [Pydantic](../backend/app/schemas/),
  [клиентские Zod-схемы](../frontend/src/lib/contracts.ts),
  [allowlist BFF](../frontend/src/app/api/v1/%5B...path%5D/route.ts).
- Кейсы, действия, Timeline и Health: [Zod интеграций](../frontend/src/lib/soc-integrations.ts),
  [SOC BFF и безопасные ошибки](../frontend/src/lib/soc-integration-proxy.ts).
- Пометки получателей: [backend-схемы](../backend/app/schemas/soc.py),
  [Zod и типы браузера](../frontend/src/lib/recipient-flag.ts).
- Доверенный круг: [серверный адаптер](../frontend/src/lib/circle-server.ts).
- Доступ BFF: [server-access.ts](../frontend/src/lib/server-access.ts);
  [границы банковского пилота](PILOT.md). API-ключ приложения не заменяет
  авторизацию владельца банковского счёта.

Таблица ниже перечисляет backend API. BFF разрешает только перечисленные в его
allowlist маршруты, проверяет запросы и ответы; наличие backend-маршрута не означает
его доступность из браузера. Имена полей, nullable-поля и enum сверять со схемами,
а не воспроизводить вручную в отдельном клиенте.

## Правила для всех клиентов

| Правило | Что значит |
|---|---|
| Ключи только на сервере | `X-BCC-API-Key`, `X-BCC-SOC-Key` и Bearer-токены интеграций добавляет серверный маршрут Next.js (`frontend/src/app/api/v1/...`). Не передавать их в `NEXT_PUBLIC_*`, URL или browser storage. Свидетельства проверок: [MAIN_READINESS.md](MAIN_READINESS.md). |
| Идемпотентность | `POST /transfers/evaluate` с тем же `request_id` возвращает сохранённое решение; другой payload с тем же `request_id` — `409`. Интеграции принимают заголовок `Idempotency-Key`. |
| Деньги решает только ядро | Telegram-контакт, Scam Check и интеграции — advisory: они не меняют статус перевода напрямую. |
| Удержание | Срок приходит из `cooling_off_until` сервера. Анкета не сокращает 15 минут; окончание таймера не отправляет перевод автоматически. При подтверждении ядро заново проверяет получателя. |
| Опрос | Интеграции делят лимит 30 запросов/мин на роль и subject: нельзя опрашивать каждый виджет отдельно раз в 2,1 с. SOC-кейсы опрашиваются раз в 60 с; Timeline/Health обновляются вручную. Все SOC-интеграции разделяют ожидание `Retry-After` после `429`. Основная лента использует отдельный core-маршрут. |
| Конфликт версии кейса | `409 case_version_conflict`: перечитать кейс, оператор подтверждает действие заново. |
| `RESOLVED` | Не означает «деньги возвращены». |
| Пометки | Национальный gateway — `MOCK`, журнал звонков — `simulated_log`. Локальная репетиция Telegram использует `FAKE`; результат transport success не доказывает доставку человеку. |
| Изменение кейса | `expected_version` и уникальный `Idempotency-Key` обязательны. После `409` нет автоматического повторения с новой версией: перечитать и получить новое явное действие оператора. |
| Неопределённый результат | После потери ответа не создавать новую операцию с новым ключом. Сначала восстановить исходный перевод/кейс и его историю; при повторении сохранять исходный идентификатор. |

## Доступ

| Заголовок | Кто держит | Для чего |
|---|---|---|
| `X-BCC-API-Key` | серверный маршрут клиентского приложения | переводы, «Банк мне звонит?» |
| `X-BCC-SOC-Key` | серверный маршрут SOC | лента SOC, граф, `/ready` |
| `Authorization: Bearer <token>` | серверные маршруты, роли `owner`, `soc`, `simulator` | доверенный круг, интеграции, кейсы SOC; токен выдаёт `scripts.integration_token` |

Правило отсутствующего ключа относится к **core** API: в `local`/`demo` без
настроенного ключа оно открыто, в `pilot` без настройки — `503`, неверный ключ — `401`.
Интеграции требуют включённого профиля и подписанного capability с ролью и сроком,
в том числе локально; роли не взаимозаменяемы.

Локальный SOC BFF берёт `BCC_SOC_CAPABILITY` только из окружения сервера; сам его
не выпускает. Сессия ограничена одним часом. Этот BFF выключен в `pilot`, public,
LAN и static-профилях. Next необходимо привязать к `127.0.0.1`: проверки Host/Origin
не заменяют сетевую изоляцию. Истёкшая сессия возвращает `401`, недоступная — `503`.
Для банка нужен отдельный согласованный SSO/RBAC-контур, а не открытие demo BFF наружу.

## Пометка получателя: сеть ловушек

`GET /api/v1/soc/recipients/{account_id}/flag` возвращает `account_id`, `flagged`,
`version`, `updated_at`. `POST` по тому же пути принимает `flagged` и причину
`note` (1–200 символов после проверки, без управляющих символов). Браузерный BFF
также требует UUID `request_id` и прочитанный `expected_version`. Для совместимости
прямой backend допускает отсутствие двух последних полей; тогда соответствующие
гарантии идемпотентности и проверки версии не применяются. Клиентам следует
передавать оба поля.

Оба метода защищены core SOC-ключом. Запись сохраняется в БД и возвращает
`RecipientFlagResponse`: состояние, `audit_id`, `actor`, `note`, `previous_flagged`.
`actor` идентифицирует сервисный ключ по отпечатку (`soc_service:...`), а в открытом
локальном демо — `local_demo_soc`. Это **не** авторизация или доказательство
личности конкретного аналитика. Сам ключ в ответ и аудит не записывается.

Повтор того же `request_id` для того же счёта и payload возвращает исходный receipt.
Изменённый payload — `409 flag_idempotency_conflict`; устаревший `expected_version`
— `409 flag_version_conflict`. После конфликта перечитать состояние и получить
новое явное подтверждение; после потери ответа не повторять изменение вслепую
с новым идентификатором. Для этих маршрутов BFF сохраняет проверенные
`flag_version_conflict`, `flag_idempotency_conflict` и `account_not_found`;
произвольные тексты ошибок backend не пересылаются. Если ответ после записи
не является корректным JSON, BFF отвечает `502 invalidResponse`, поскольку
результат записи неизвестен; `422 invalid` предназначен для невалидного входного
запроса.

После commit флаг обновляется в графе; сохранённые флаги восстанавливаются при
запуске и проверяются на границах скоринга/чтения графа. Для решения используется
доверенный снимок флага из SQL: устаревшая локальная копия графа после rebuild
не должна отменять установленную пометку или возвращать снятую. Это внутренний
сигнал сервера, не принимаемое из браузера поле.

Новые оценки других отправителей используют `RECIPIENT_FLAGGED`. Уже сохранённые
решения не пересчитываются автоматически при изменении флага. Однако попытка
подтвердить **удержанный** перевод снова читает актуальный флаг: даже чистая
анкета до окончания таймера может привести к `blocked` с причиной
`RECIPIENT_FLAGGED_AT_RELEASE` и баллом не ниже 90. Красные ответы анкеты
обрабатываются существующей политикой до этой ветки.

Снятие пометки убирает этот сигнал из следующей новой оценки, но не стирает аудит,
другие причины и не возвращает уже заблокированный перевод в разрешённое состояние.
Повтор старого POST возвращает прежний receipt, не применяя флаг заново поверх более
новой версии; текущее состояние получают через GET. Это пометка антифрода, не
банковская проводка и не возврат денег.

`GET /api/v1/soc/feed?alerts_only=true` показывает удержанные и заблокированные переводы,
а также операции с сообщением клиента об обмане после звонка или просьбе вернуть деньги
на другой счёт. Остальные фильтры применяются совместно с ним. Статистика ленты остаётся общей,
а `pagination.total_filtered` относится к отфильтрованным строкам.

## Адаптер ядра банка / Банктің төлем ядросы

Проектный интерфейс для согласования с банком. Публичный стенд выполняет учебные операции. Перечисленные команды не зарегистрированы как маршруты FastAPI. Окончательное проведение и баланс подтверждает банковское ядро.

| Команда | Запрос | Подтверждённый эффект |
|---|---|---|
| hold / ұстап тұру | tenant_id, transfer_id, operation_id, сумма в тиынах, KZT, send_account_ref, recipient_ref, expires_at UTC | Резерв точной суммы. Ответ содержит ledger_ref, state=held, version и время. |
| cancel / тоқтату | тот же transfer_id, новый operation_id, expected_version, ledger_ref | Снятие резерва один раз, state=cancelled. Из released отмена этим методом запрещена. |
| release / шығару | тот же transfer_id, новый operation_id, expected_version, ledger_ref и результат повторной проверки | После истечения паузы и успешной проверки резерв проводится ровно один раз, state=released. Истечение таймера само по себе ничего не переводит. |
| lookup / күйін сұрау | tenant_id и operation_id либо ledger_ref | Возвращает подтверждённый результат или pending для сверки после неопределённого ответа. |

Идемпотентность действует в области tenant_id + operation_id. Адаптер фиксирует канонический хэш неизменяемых полей, состояние и квитанцию в одной транзакции. Точный повтор возвращает исходную квитанцию. Иной payload с тем же идентификатором даёт конфликт. Версия и блокировка операции разрешают гонку отмены и выпуска. При тайм-ауте клиент сначала запрашивает состояние и при необходимости повторяет исходный ключ. Новая попытка с новым ключом требует нового платёжного поручения. По HTTP 401/403 оператор восстанавливает доступ, по 409 сверяет версию и исход операции, по 422 исправляет запрос, по 429/503 применяет ограниченный повтор с прежним ключом. В журнале нужны correlation_id и время подтверждения без банковских реквизитов. Недоступность ядра оставляет результат неопределённым до сверки.

Пилотқа арналған келісім. Банк соманы тиынмен қабылдайды, операцияның күйін, нұсқасын және түбіртегін қайтарады. Бір кілтпен қайталау бастапқы нәтижені береді. Сома не алушы өзгерсе, сұрау қайшылық ретінде қабылданады. Тайм-ауттан кейін алдымен операцияның күйін тексеру керек. Ұстау мерзімі аяқталғанда тексеру қайта жүргізіледі. Ақшаны шығару мен резервтен босату бір операцияға қатар орындалмайды. Қолжетімділік, қолтаңба, сақтау мерзімі және салыстырып тексеру тәртібі банкпен келісуді қажет етеді.

[Дербес деректер / Персональные данные](PRIVACY_KZ_RU.md)

## Ошибки

| Код | Когда | Тело |
|---|---|---|
| `401` | нет или неверный ключ/токен | `{"detail": "..."}` |
| `403` | недостаточная роль, чужой владелец или недоверенный origin BFF | `{"detail": "..."}` / BFF `{"error": "..."}` |
| `404` | нет записи; демо-управление вне демо | `{"detail": "..."}` |
| `409` | повтор `request_id` с другим телом; повторный ответ на анкету; конфликт версии кейса | `{"detail": "..."}` |
| `410` | истёкший кейс или инцидент | `{"detail": "..."}` |
| `413` | тело больше `BCC_MAX_REQUEST_BYTES` (16 КБ по умолчанию) | `{"detail": "..."}` |
| `422` | невалидный запрос (Pydantic) | `{"detail": [...]}` |
| `429` | core: `BCC_REQUEST_RATE_LIMIT_PER_MINUTE` (120 по умолчанию); интеграции: отдельный лимит capability | заголовок `Retry-After`, если выдан |
| `502` | BFF не получил валидный ответ backend | `{"error": "apiError"}` / `{"error": "invalidResponse"}` |
| `503` | недоступная зависимость/настройка; история счёта сверх ёмкости скоринга (fail-closed) | `Retry-After: 60` для недоступности core; не универсальный заголовок всех ошибок |

Backend интеграций отвечает `{"detail": "<код>"}` через `IntegrationError`.
Core BFF возвращает `{"error": "notFound" | "conflict" | "invalid" |
"requestTooLarge" | "rateLimited" | "apiError"}`. SOC BFF сохраняет только
разрешённые пары status/code (например `409 case_version_conflict`), остальные
переводит в безопасные ошибки, включая `integrationSessionExpired`,
`integrationForbidden`, `integrationsUnavailable`, `invalidResponse`.
Точный allowlist — в `safeSocProxyError`; произвольный текст backend не показывается.

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

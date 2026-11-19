# Saq Bol — контракты API

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


### meta

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `GET` | `/health` | — | — | `object` | 200 |
| `GET` | `/ready` | `X-BCC-SOC-Key` | — | `object` | 200, 422 |

### transfers

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `POST` | `/api/v1/transfers/requests/{request_id}/abandon` | `X-BCC-API-Key` | — | `AbandonRequestResponse` | 200, 422 |
| `POST` | `/api/v1/transfers/evaluate` | `X-BCC-API-Key` | `TransferEvaluateRequest` | `TransferEvaluateResponse` | 200, 422 |
| `GET` | `/api/v1/transfers/{transaction_id}` | `X-BCC-API-Key` | — | `TransferEvaluateResponse` | 200, 422 |
| `POST` | `/api/v1/transfers/{transaction_id}/resolve-cooling` | `X-BCC-API-Key` | `ResolveCoolingRequest` | `TransferEvaluateResponse` | 200, 422 |
| `POST` | `/api/v1/transfers/{transaction_id}/cancel` | `X-BCC-API-Key` | — | `TransferEvaluateResponse` | 200, 422 |

### call-check

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `POST` | `/api/v1/call-check` | `X-BCC-API-Key` | `CallCheckRequest` | `CallCheckResponse` | 200, 422 |
| `POST` | `/api/v1/call-check/demo/bank-call` | `X-BCC-API-Key` | `DemoBankCallRequest` | `DemoBankCallResponse` | 200, 422 |

### soc

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `GET` | `/api/v1/soc/feed` | `X-BCC-SOC-Key` | — | `FeedResponse` | 200, 422 |
| `GET` | `/api/v1/soc/graph/{account_id}` | `X-BCC-SOC-Key` | — | `GraphResponse` | 200, 422 |

### trusted contacts (advisory)

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `GET` | `/api/v1/trusted-contacts` | Bearer | — | `ContactsOut` | 200 |
| `POST` | `/api/v1/trusted-contacts` | Bearer | `InviteRequest` | `InvitationOut` | 201, 422 |
| `DELETE` | `/api/v1/trusted-contacts/{contact_id}` | Bearer | — | `ContactOut` | 200, 422 |
| `POST` | `/api/v1/trusted-contacts/transactions/{transaction_id}/notifications` | Bearer | `NotificationRequest` | `NotificationOut` | 200, 422 |
| `GET` | `/api/v1/trusted-contacts/transactions/{transaction_id}/notifications` | Bearer | — | список `NotificationOut` | 200, 422 |
| `GET` | `/api/v1/trusted-contacts/notifications/{notification_id}/history` | Bearer | — | список `AuditOut` | 200, 422 |
| `POST` | `/api/v1/trusted-contacts/simulator/update` | Bearer | `SimulatedUpdate` | `UpdateOut` | 200, 422 |
| `PATCH` | `/api/v1/trusted-contacts/{contact_id}/preferences` | Bearer | `ContactPreferences` | `ContactOut` | 200, 422 |

### MOCK enrichment — synthetic demonstration only

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `POST` | `/api/v1/external-checks` | Bearer + Idempotency-Key | `ExternalCheckRequest` | `ExternalCheckOut` | 200, 422 |
| `GET` | `/api/v1/external-checks/{check_id}` | Bearer | — | `ExternalCheckOut` | 200, 422 |

### advisory orchestration

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `GET` | `/api/v1/integrations/soc/transactions/{transaction_id}/timeline` | Bearer | — | `TimelinePage` | 200, 422 |
| `GET` | `/api/v1/integrations/health/details` | Bearer | — | `HealthDetails` | 200 |
| `GET` | `/api/v1/integrations/soc/transactions/{transaction_id}/summary` | Bearer | — | `IncidentSummary` | 200, 422 |
| `POST` | `/api/v1/integrations/transactions/{transaction_id}` | Bearer + Idempotency-Key | `OrchestrationRequest` | `RunOut` | 202, 422 |
| `GET` | `/api/v1/integrations/transactions/{transaction_id}` | Bearer | — | `RunOut` | 200, 422 |
| `GET` | `/api/v1/integrations/soc/transactions/{transaction_id}` | Bearer | — | `EnrichmentOut` | 200, 422 |
| `GET` | `/api/v1/integrations/health` | Bearer | — | `IntegrationHealth` | 200 |

### Guardian demo reports

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `POST` | `/api/v1/integrations/guardian/reports` | Bearer + Idempotency-Key | `ReportRequest` | `ReportOut` | 201, 422 |
| `GET` | `/api/v1/integrations/guardian/reports` | Bearer | — | список `ReportOut` | 200, 422 |
| `GET` | `/api/v1/integrations/guardian/reports/{report_id}` | Bearer | — | `ReportOut` | 200, 422 |
| `POST` | `/api/v1/integrations/guardian/reports/{report_id}/acknowledge` | Bearer | — | `ReportOut` | 200, 422 |
| `GET` | `/api/v1/integrations/guardian/reports/{report_id}/history` | Bearer | — | список `AuditOut` | 200, 422 |

### Guardian synthetic SOC cases

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `POST` | `/api/v1/integrations/guardian/soc/cases` | Bearer + Idempotency-Key | `OpenCase` | `CaseOut` | 201, 422 |
| `GET` | `/api/v1/integrations/guardian/soc/cases` | Bearer | — | `CasePage` | 200, 422 |
| `GET` | `/api/v1/integrations/guardian/soc/cases/analytics` | Bearer | — | `CaseAnalytics` | 200 |
| `GET` | `/api/v1/integrations/guardian/soc/cases/{case_id}` | Bearer | — | `CaseOut` | 200, 422 |
| `POST` | `/api/v1/integrations/guardian/soc/cases/{case_id}/actions` | Bearer + Idempotency-Key | `object` | `CaseOut` | 200, 422 |
| `GET` | `/api/v1/integrations/guardian/soc/cases/{case_id}/history` | Bearer | — | `EventPage` | 200, 422 |
| `GET` | `/api/v1/integrations/guardian/soc/cases/{case_id}/notes` | Bearer | — | `ContentPage` | 200, 422 |
| `GET` | `/api/v1/integrations/guardian/soc/cases/{case_id}/evidence` | Bearer | — | `EvidenceOut` | 200, 422 |
| `GET` | `/api/v1/integrations/guardian/soc/cases/{case_id}/export` | Bearer | — | `CaseExport` | 200, 422 |
| `GET` | `/api/v1/integrations/guardian/reports/{report_id}/information-requests` | Bearer | — | список `InformationOut` | 200, 422 |
| `POST` | `/api/v1/integrations/guardian/reports/{report_id}/information-requests/{request_id}` | Bearer + Idempotency-Key | `AnswerInformation` | `AnswerReceipt` | 200, 422 |

### integration operations and privacy

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `GET` | `/api/v1/integrations/soc/operations/notifications` | Bearer | — | `JobPage` | 200, 422 |
| `GET` | `/api/v1/integrations/soc/operations/queue` | Bearer | — | `QueueSummary` | 200 |
| `GET` | `/api/v1/integrations/privacy/permissions` | Bearer | — | `PermissionPage` | 200, 422 |
| `GET` | `/api/v1/integrations/privacy/contacts/{contact_id}/history` | Bearer | — | `PermissionHistory` | 200, 422 |

Коды `401`, `413`, `429`, `503` из раздела «Ошибки» относятся ко всем путям `/api/v1` и в схеме отдельно не перечислены.

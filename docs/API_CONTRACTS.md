# Saq Bol — контракты API

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
| `POST` | `/api/v1/transfers/{transaction_id}/cancel` | `X-BCC-API-Key` | `CancelTransferRequest` | `TransferEvaluateResponse` | 200, 422 |
| `POST` | `/api/v1/transfers/{transaction_id}/post-call` | `X-BCC-API-Key` | `PostCallRequest` | `TransferEvaluateResponse` | 200, 422 |

### linked returns

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `GET` | `/api/v1/returns/incoming` | `X-BCC-API-Key` | — | `IncomingPage` | 200, 422 |
| `GET` | `/api/v1/returns/{original_id}` | `X-BCC-API-Key` | — | `IncomingPayment` | 200, 422 |
| `POST` | `/api/v1/returns/{original_id}` | `X-BCC-API-Key` | `ReturnAction` | `IncomingPayment` | 200, 422 |
| `POST` | `/api/v1/soc/returns/{original_id}/review` | `X-BCC-SOC-Key` | `ReturnReview` | `IncomingPayment` | 200, 422 |

### call-check

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `POST` | `/api/v1/call-check` | `X-BCC-API-Key` | `CallCheckRequest` | `CallCheckResponse` | 200, 422 |
| `POST` | `/api/v1/call-check/demo/bank-call` | `X-BCC-API-Key` | `DemoBankCallRequest` | `DemoBankCallResponse` | 200, 422 |

### scam-check

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `GET` | `/api/v1/scam-check/guide` | `X-BCC-API-Key` | — | `ScamGuide` | 200, 422 |

### soc

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `GET` | `/api/v1/soc/accounts/{account_id}/trace-anchors` | `X-BCC-SOC-Key` | — | `TraceAnchors` | 200, 422 |
| `GET` | `/api/v1/soc/transfers/{transaction_id}/funds-trace` | `X-BCC-SOC-Key` | — | `FundsTrace` | 200, 422 |
| `GET` | `/api/v1/soc/feed` | `X-BCC-SOC-Key` | — | `FeedResponse` | 200, 422 |
| `GET` | `/api/v1/soc/recipients/{account_id}/flag` | `X-BCC-SOC-Key` | — | `RecipientFlagState` | 200, 422 |
| `POST` | `/api/v1/soc/recipients/{account_id}/flag` | `X-BCC-SOC-Key` | `RecipientFlagRequest` | `RecipientFlagResponse` | 200, 422 |
| `GET` | `/api/v1/soc/recipients/{account_id}/prior-receipts` | `X-BCC-SOC-Key` | — | `PriorReceipts` | 200, 422 |
| `GET` | `/api/v1/soc/graph/{account_id}` | `X-BCC-SOC-Key` | — | `GraphResponse` | 200, 422 |

### trusted contacts (advisory)

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `GET` | `/api/v1/trusted-contacts/web-session` | `X-BCC-API-Key` | — | `object` | 200, 422 |
| `POST` | `/api/v1/trusted-contacts/web-session` | `X-BCC-API-Key` | `CircleLogin` | `CircleSession` | 200, 422 |
| `DELETE` | `/api/v1/trusted-contacts/web-session` | `X-BCC-API-Key` | — | — | 204, 422 |
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
| `GET` | `/api/v1/integrations/soc/transactions/{transaction_id}/story` | Bearer | — | `PrivateStory` | 200, 422 |
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

### Private Scam Check

| Метод | Путь | Доступ | Тело | Ответ | Коды в схеме |
|---|---|---|---|---|---|
| `POST` | `/api/v1/integrations/guardian/scam-check` | Bearer | `ScamCheckRequest` | `ScamCheckResult` | 200, 401, 403, 422, 429, 503 |

Коды `401`, `413`, `429`, `503` из раздела «Ошибки» относятся ко всем путям `/api/v1` и в схеме отдельно не перечислены.

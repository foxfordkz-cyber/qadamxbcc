# Bekzat — final verification (2026-11-14)

Проверенный implementation SHA: `e23df31514553990b59b9c0181046aff2c1c63fa`.
Core baseline: `a02d20dcc857001de364e0b0f12a66ce72db0c12`. Исходная точка нового аудита: c905b68.
Сначала прежние утверждения были сверены с Git/PR/CI и повторным baseline verify:
130 backend passed, 6 live-only skipped, 12 frontend passed; ALL GREEN.
Новые результаты ниже относятся к актуальному implementation tree, не к старому отчёту.
Позднейший documentation-only commit имеет собственные PR checks; его финальный SHA
и CI записаны в итоговом пакете, чтобы документ не ссылался на собственный будущий hash.

## Результаты

| Проверка | Наблюдаемый результат |
|---|---|
| Полный финальный verify.sh | ALL GREEN; Ruff check/format, strict mypy, pytest, tsc, frontend tests/build, оба Compose config |
| Backend в финальном CI oracle | 165 passed, 6 live-only skipped без live variables |
| PostgreSQL 16 + Redis 7, финальная CI integration suite | 123 passed, включая все 6 live-only |
| Локальный oracle/live до CI-only regression test | 164 passed / 6 skipped; 122 live passed; затем новый masking test отдельно PASS |
| Уникальные backend cases в совокупности | 171 = 48 существующих core + 123 integration; reruns не складываются |
| Frontend | 12 существующих tests PASS, TypeScript и Next.js build PASS; frontend не изменялся |
| Добавлено за этот аудит | 35 уникальных cases: Telegram 7, gateway 11, recovery/outbox 2, handoff examples/OpenAPI 14, CI masking 1 |
| Backport в PR A | 2 уже существовавших C cases перенесены в A; не считаются новыми в combined total |
| Самостоятельная A live suite | 47 passed |
| Самостоятельная A+B live suite | 88 passed |
| Миграции | PostgreSQL upgrade head → downgrade 0001 → upgrade head, alembic check PASS; SQLite parity PASS |
| DB changes | Новых миграций в этом аудите нет; остаются 0002–0004, пять integration tables |
| Contracts | 13 request/response examples validated; full exported OpenAPI equals application |
| Existing API compatibility | Все current-main paths/components структурно идентичны; 13 additive operations |
| Ownership | Нет authored diff в frontend, services, core schemas/routes/entities, base Compose |
| Docker | Пять healthy services; localhost synthetic normal/scam/hub E2E PASS |
| Secret scan | Известные private-key/GitHub/Telegram/AWS token patterns не найдены в tracked files; ограниченная проверка |

Числа — параметризованные test cases, не количество test functions. 117 integration
cases переносимые, 6 live-only. Тесты handoff проверяют реальные route request/response
models, включая exact serialized output, success status и размещение в OpenAPI.

## Воспроизведённые проблемы и исправления

| Проблема | До исправления | Исправление / regression |
|---|---|---|
| Явный Telegram flood-control rejection не повторялся | 2 retry tests FAIL на старой A | e7fdd17: один bounded retry, максимум две попытки; retry_after <=1s, общий timeout; audit без приватного текста |
| Polling выпускал malformed input/Redis exception наружу | 2 ingress tests FAIL с validation/private context | e7fdd17: aiogram router error boundary + bounded Redis admission; tests feed real dispatcher with mocked HTTP |
| A не содержала consent refresh/FK-safe lock fixes из C | 2 live regressions FAIL на старой A | e7fdd17: populate_existing и FOR NO KEY UPDATE; переданы в самостоятельный PR A |
| Gateway без RU/KK descriptions/network fixture | 10 localization acceptance cases FAIL на прежней B | 20e62cf: normalized descriptions + SYN-NETWORK-001; 11 cases PASS с проверкой покрытия enums |
| COMPLETE run сохранял старую ошибку | recovery test FAIL: INTEGRATION_WORKER_ERROR остаётся | a177120: error очищается при новой попытке, история audit остаётся; recovery PASS |
| Неполный демонстрационный/handoff пакет | только один script scenario и фрагменты examples | cb63483: три runtime-сценария, полный OpenAPI/examples/UI texts, 14 CI contract cases |
| CI показывал ephemeral demo signing key в environment-секции | обнаружено в старом compose-demo log без вывода значения; новый поведенческий test FAIL на прежнем command | 444da14/e23df31: add-mask до GITHUB_ENV; test PASS, новый run log без немаскированного значения |

Новый outbox failure-injection test отдельно подтверждает: ошибка commit после flush
откатывает job и audit вместе, не меняет уже сохранённый core transfer и не вызывает
adapter. Это outbox integration intent, а не автоматическая публикация всех core
транзакций: optional integration POST выполняется после evaluate, что явно отражено
в контракте. Client crash между этими двумя запросами не создаёт незапрошенный job.

Маскирование следует [GitHub workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#masking-a-value-in-a-log).
Behavioral regression исполняет реальную команду генерации из workflow и проверяет,
что экспортированный ключ зарегистрирован для masking; значения не попадают в failure
output. Исторические CI-логи не удалялись; их одноразовые стенды уже уничтожены.
Существующие пользовательские/GitHub secrets не менялись. Сырой старый CI log с
ключом не включён в evidence archive; сохранён только факт обнаружения и IDs run/job.

Длительный retry_after не был замаскирован как поддержанный: T10 PARTIAL в матрице.
Ambiguous send/timeout не повторяется автоматически. Реальная Telegram-доставка
T09 BLOCKED: dispatcher/adapter mocks не считаются live доказательством.

## GitHub и review

| PR | Проверенный head | Состояние на проверке | CI |
|---|---|---|---|
| [#1](https://github.com/foxfordkz-cyber/qadamxbcc/pull/1) | `e7fdd171c0bf607439c678278c715f30dab44b1b` | open, Draft, unmerged | [SUCCESS](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/43555909599) |
| [#2](https://github.com/foxfordkz-cyber/qadamxbcc/pull/2) | `71b1c3a64600020fc44c4c8df7613b103a15c0db` | open, Draft, unmerged | [SUCCESS](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/43556125459) |
| [#3](https://github.com/foxfordkz-cyber/qadamxbcc/pull/3) | `e23df31514553990b59b9c0181046aff2c1c63fa` | open, Draft, unmerged | [SUCCESS](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/43557924729) |

Stack A → main, B → A, C → B сохранён; merge commits только внутри feature stack,
без force push. Конфликты test_live_persistence разрешены объединением всех tests;
существующие C cases не продублированы. Human reviews/comments на момент проверки
отсутствуют. Mergeability=true. Это не owner approval; main не изменён агентом.

## Runtime evidence

| Demo | Core status после интеграций | Transaction | Result |
|---|---|---|---|
| normal | approved | `95623625-753a-4aed-99a9-a116277f7e0b` | PASS |
| scam | cooling_off | `9f222096-9c0e-434e-9725-3126074aace1` | PASS |
| hub | blocked | `17ec8581-e437-4205-8b26-966fbaf7d7ec` | PASS |

Scam: SUSPICION_REPORTED в SOC; source MOCK; контакт отозван скриптом после проверки.
Hub: core bilingual reasons + suspected_mule и SYNTHETIC_NETWORK_SIGNAL в enrichment;
контакт/уведомление не создаются. Normal: нет run, checks и notifications.
Подробный walkthrough: [BEKZAT_DEMO_GUIDE.md](BEKZAT_DEMO_GUIDE.md).

## Повторный latency experiment

Использован существующий core-owned scripts.benchmark_antifraud, без копии scorer.
Одинаковый Python 3.12.16, resolved environment, локальный real Redis DB14; 3 runs ×
500 evaluations после 30 warmups на pinned main и integrated source. Билды и тесты
были завершены перед замером. Scope: warmed engine/ML/graph/Redis, без HTTP и SQL.

Main run p95 ms: 4.017225, 3.414760, 6.534625.
Integrated run p95 ms: 4.920400, 10.470195, 3.675860.
Медианы run p95: 4.017225 → 4.920400 ms; разница +0.903175 ms
(+22.48%). Это наблюдение на одном хосте и трёх последовательных
прогонах, без randomized/interleaved design; не causal speedup/regression claim и
не production SLA. Off-path isolation также проверена тестом, который подтверждает
нулевые provider calls во время scoring/enqueue.

## Команды и изоляция

```bash
bash verify.sh
export BCC_TEST_DATABASE_URL=postgresql+asyncpg://bcc:bcc@localhost:5432/bcc_integration_test
export BCC_TEST_REDIS_URL=redis://localhost:6379/15
cd backend
uv run pytest tests/integrations
```

Live fixtures создают отдельные схемы в явно названной test DB; Redis15 выделена
только тестам и очищается fixture. Migration roundtrip использует отдельную
bcc_integration_test_migrations. Demo использует другую DB bcc_shield/Redis0;
benchmark — Redis14. Старые demo volumes не пересоздавались; новый disposable проект
bcc-bekzat-final подготовлен с существующим локальным config без изменения секретов.
Логи команд и before/after regressions включены в финальный evidence archive.

## Решения

Local fake demo GO. Team integration GO для feature/test подключения; финальный
merge и UI acceptance ожидают owner/frontend review. Production NO-GO: нет bank IAM,
approved real-provider integration, retention/encryption/operations security sign-off.
Ни реального Telegram, ни НБК, ни денежных переводов, ни production deployment здесь не было.
AI-assisted implementation и проверка явно указаны; независимый human security review
не заявляется. [Матрица](BEKZAT_90_PERCENT_AUDIT.md) оставляет зависимости с нулём баллов.

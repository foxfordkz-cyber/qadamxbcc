# Guardian 3.0 — release verification

15 ноября 2026. Проверенный runtime HEAD: `b61b17d1f7358ecbf8d04d5d0bc1e33837cc0721`.
Это локальный синтетический demo-релиз. Main не изменён, production deploy не выполнялся.

## 1. Что было готово и что добавлено

Guardian 2.0 содержал Trusted Contact, Mock Gateway, off-path Orchestrator, durable Retry-After,
Incident Timeline/Health, RU/KK bot UX/Scam Check, Circle на три контакта, Report/SOC summary.
Исходные 234 уникальных backend-теста и 12 frontend-тестов подтверждены CI PR #7, включая
новый commit аудита 5c5843c (run 43701450613). Повторная реализация этих модулей не выполнялась.

Guardian 3 добавляет отдельный Fraud Case Management: открытие из существующего обращения,
категория, два тестовых ответственных, внутренние заметки, строгие шесть статусов, запрос
уточнения через owner demo API, ответ, закрытие/повторное открытие, история и экспорт.
Добавлены фактическая SOC-аналитика, диагностика очереди/терминальных отказов, экспорт собственных
согласий и их истории, локальная блокировка конкурирующих polling-процессов.

Статус RESOLVED означает завершение демонстрационного рассмотрения, не возврат денег или
решение банка. Запросы контактного автора не направляются владельцу банковского аккаунта.
Новая массовая рассылка, повтор неизвестной доставки и второй antifraud engine отсутствуют.
P2: отдельную базу советов/новый checklist отложили; используется существующая factual summary,
а обезличенный экспорт реализован как часть P0. Дополнительные модули ради объёма не создавались.

## 2. Исправления и ограничения, выявленные при проверке

При разработке исправлены очистка дочерних записей кейса в SQLite без FK pragma и регистрация
нового router в генераторе контрактов. Один ранний portable-прогон видел старую импортированную
схему одновременно с обновлением OpenAPI; повтор 34 контрактов и чистый CI подтвердили совпадение.

Windows дважды отказала в создании тестового дочернего процесса (WinError 5 до исполнения кода).
ACL/защита не менялись. В тесте явно задан stdin pipe и ожидание команды родителя вместо таймера;
только конкретный Windows отказ создания процесса может дать явный skip. Отдельный итоговый
повтор обеих lock-проверок прошёл, как и весь финальный Windows verify: дополнительного skip
не было. Linux CI выполнил crash-тест. Ранние неуспешные прогоны сохранены в verification.json.

Polling lock действует на одном хосте; несколько хостов требуют ограничения replicas со стороны
оператора. Вызов провайдера, уже находящийся в полёте, нельзя отозвать. Доставка и revoke
сериализованы по контакту; после фиксации revoke новый send не начинается. Неизвестный исход
не повторяется. Inherited demo PostgreSQL synchronous_commit=off и Redis без AOF/RDB не дают
гарантии сохранности при потере питания; это не production durability.

## 3. GitHub и сохранение вклада

- PR #1–7 готовы к review; owner approvals и merge не выполнены.
- [PR #8 — Case Management](https://github.com/foxfordkz-cyber/qadamxbcc/pull/8), Draft,
  HEAD a9e51f7: [CI PASS](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/43704163941).
- [PR #9 — Operations/Privacy](https://github.com/foxfordkz-cyber/qadamxbcc/pull/9), Draft,
  runtime b61b17d: [CI PASS](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/43706232756).

Порядок #1 → #2 → #3 → #4 → #5 → #6 → #7 → #8 → #9. После принятия родителя владелец должен
переключить base следующего PR на main и повторно проверить diff/CI. Разрешённые владельцем
merge commits сохраняют исходные SHA. Squash/rebase, force push, подмена авторов и merge в main
не выполнялись. Новый документальный evidence commit после runtime не меняет код; его статус
CI следует проверять в checks PR #9. Main по повторному fetch остаётся a02d20d.

Причина Contributors установлена: все 37 Bekzat commits runtime-снимка связаны с bekzatwr,
но 0 доступны из main. Ошибка связи email не обнаружена; приватный verified-флаг недоступен.
Отчёт публикации добавляет один содержательный документационный commit. После отдельного
разрешённого merge нужно проверить reachability исходных SHA и дать статистике GitHub
пересчитаться; сейчас появление в Contributors не заявляется выполненным.

## 4. Tests: уникальные случаи и исполнения

| Итоговая проверка runtime | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Portable backend, Linux CI и финальный локальный Windows verify | 259 | 12 | 0 |
| PostgreSQL + Redis integration, Linux CI | 223 | 0 | 0 |
| Existing frontend tests | 12 | 0 | 0 |

Объединение backend-наборов: **271 уникальный test case**, на 37 больше Guardian 2.0.
Это 15 case-тестов, 7 operations-тестов и 15 новых JSON contract cases. Frontend отдельно — 12.
В одном release CI matrix backend исполнялся 494 раза: 482 успешных исполнения и 12 skips.
Эти 482 не являются количеством уникальных тестов. В совокупности с frontend — 506 запусков
(494 успешных, 12 skips). Повторные локальные/CI прогоны не увеличивают unique count.

Ruff lint/format: 130 файлов. Strict mypy: 129 source files. Полный локальный verify.sh и CI
прошли, включая TypeScript/build и Compose config. Локальный PostgreSQL-прогон до обработки
ограничения Windows: 222 passed и один отказ child creation; все 223 затем прошли Linux CI.
37 JSON request/response examples валидируются по опубликованным маршрутам; OpenAPI совпадает
с приложением. Старые пути и component schemas равны снимку PR #7.

## 5. Миграции и локальный Docker E2E

Новая миграция **0007_guardian_cases**, после 0006: guardian_cases, guardian_case_events,
guardian_case_content. Upgrade/downgrade/upgrade и ORM parity прошли на PostgreSQL и SQLite;
повторяются в CI. Старая миграционная история сохранена.

Отдельный проект bcc-bekzat-guardian3 собран из runtime b61b17d: PostgreSQL, Redis, FastAPI,
frontend и integration-worker healthy. Старые demo-проекты остановлены, volumes сохранены.
На новой синтетической базе локально и в CI прошли шесть сценариев:

1. Approved preset, без уведомления.
2. Social engineering → Cooling-Off → Fake notification → suspicion/SOC.
3. Suspicious recipient network → blocked + MOCK gateway evidence.
4. Explicit Guardian report → DEMO_ACKNOWLEDGED.
5. Case assign/review/note/question/answer/resolve/close/reopen, версия 10.
6. Queue inspection + own permissions/history + role denial.

Реальные stop/start Redis и PostgreSQL отразились как degraded/unavailable и восстановились
до ok. Worker остановлен дольше heartbeat TTL, затем восстановился. После рестартов сохранились
ровно одно уведомление с SUSPICION_REPORTED и один NOTIFICATION_SENT audit, отчёт и кейс версии
10 с десятью событиями. Redis-server restart удалил синтетический TTL-маркер временного draft согласно
volatile-конфигурации; автоматическая повторная отправка/подача отсутствует. Это отдельная
проверка процесса/сервиса, не mock reconnect, и не гарантия при отключении питания.

## 6. Свежие измерения, миллисекунды

| Scope | N | p50 | p95 | p99 | Errors |
|---|---:|---:|---:|---:|---:|
| Scoring + graph + Redis, без HTTP/SQL | 500 | 1.3443 | 2.8988 | 4.416 | 0 |
| HTTP + SQL + scoring | 100 | 74.7063 | 120.4993 | 202.6128 | 0 |
| Постановка интеграции через HTTP | 20 | 62.5818 | 82.1439 | 103.7267 | 0 |
| Ожидание очереди | 20 | 346.786 | 574.487 | 578.421 | 0 |
| Обработка интеграции | 20 | 13.349 | 29.037 | 191.099 | 0 |
| Чтение страницы кейсов через HTTP | 20 | 10.102 | 19.1571 | 19.1926 | 0 |

У каждого ряда собственная область измерения. Engine: N=500 после 30 warmups, graph + реальный
Redis DB14, без HTTP/SQL. HTTP: N=100 после 10 warmups, loopback + FastAPI + SQL + scoring;
повторный синтетический sender может получать разные risk decisions. Queue/processing: N=20
mock-gateway jobs, один worker, по сохранённым audit timestamps. Case query: N=20 после трёх
warmups, одна retained синтетическая case-запись, auth/Redis + PostgreSQL + HTTP. Это не тест
масштабирования. На N=20 p99 — максимум выборки. Quantiles — nearest rank.

Ошибка означает исключение/неуспешный HTTP или незавершённую integration job, не fraud accuracy.
Прогон выполнен после сборки, QA и восстановления, без параллельного benchmark. Значения Guardian
2.0 не являются контрольной группой этого эксперимента; улучшение скорости, SLA и причинная
регрессия не заявляются. Case/ops выполняются отдельными API и worker, core scoring не менялся.
Raw данные: evidence/guardian3-latency.json, восстановление: evidence/guardian3-recovery.json.
Для engine существует scripts.benchmark_antifraud; HTTP/queue workload и параметры приведены
в raw scope/workload полях. Локальные harness-файлы guardian3_benchmark.py и guardian3_recovery.py
сохранены вне Git рядом с рабочими worktrees; секреты читаются локально, в evidence не попадают.

## 7. API, handoff и совместимость

15 новых операций: 11 case/info/analytics/export и 4 operations/privacy. Полная таблица методов,
ролей, моделей, ошибок и UI-действий — FRONTEND_HANDOFF.md и OPERATIONS_PRIVACY.md. Типизированный
generated contract — существующий OpenAPI 3.1; JSON examples и RU/KK labels обновлены в прежнем
bundle. Параллельного SDK и изменений чужого frontend нет.

Frontend-команде нужно подключить case list/detail/history/notes, owner information inbox,
permissions export и diagnostics через текущий api<T>; решить сохранение safe detail error
codes в существующем helper, проверить 409/version UX и RU/KK подписи. Case expiry показывать
явно. Контракт и сценарии переданы через PR/docs; принятие Дамиром/командой не утверждается.

Diff новых работ в frontend, app/core, app/services и transfers.py пуст. Main остаётся предком;
merge-tree preparation без конфликтов. Интеграции не встроены в latency-critical scoring path.

## 8. Реальный инженерный вклад

Подробный ledger: ../contributions/BEKZAT_ENGINEERING_CONTRIBUTION.md. На runtime-снимке 37
уникальных авторских commits (26 обычных, 11 merge), 9 PR, 0 commits в main. Churn исключает
чужих авторов и merge diffs. Без generated/lock/media/evidence/data: +14926 / -807 строк по
истории собственных ordinary commits. Текущие собственные непустые Python-строки без комментариев
и docstrings по git blame: implementation 5794, tests 2938. Это разные метрики, не доля проекта.
Содержательный release-evidence commit добавляет только документацию, не инженерные LOC runtime.

## 9. Остаток до полуфинала и GO/NO-GO

До 26 ноября — 11 календарных дней от даты отчёта. Приоритет: review владельцем 0007/retention/
role boundaries, совместные четыре frontend/SOC demo flows из handoff, согласование merge order,
и проверка на общем test-окружении после каждого принятого PR. Не добавлять P2 до этой приёмки. Многочасовой production burn-in не проводился;
локально наблюдался healthy worker при простое в течение нескольких минут и после рестартов.

- **Local fake API/hackathon demo: GO**, шесть сценариев и восстановление проверены.
- **Team integration в feature/test-ветке: GO** для подключения контракта; совместная приёмка
  ещё не выполнена. Main merge остаётся закрыт до отдельного разрешения владельца.
- **Production: NO-GO**: demo capabilities вместо IAM, mock gateway, volatile demo storage,
  один polling host, не согласована production retention/backup policy и нет внешней приёмки.

Новых реальных Telegram сообщений: **0**. Live Telegram в Guardian 3 **NOT RUN**; прошлое
разрешение не переиспользовалось. Telegram-токены и реальные chat ID не считывались и не публиковались. Реальные клиенты,
банковские переводы и NBK не использовались; тестовые API capabilities выдавались локально.
Платных сервисов и production deployment нет. Approvals владельца и frontend/SOC отсутствуют;
100% готовности и появление в Contributors не заявляются.

# Бекзат: Private Scam Check и QA — 19 ноября 2026

PR: [#16](https://github.com/foxfordkz-cyber/qadamxbcc/pull/16), Draft.
Base: `feature/bekzat-demo-readiness` / PR #15, `d20a88a`.
Feature implementation: `9037ea6`; readiness/Windows verification fix: `342c0e5`.
Оба commit связаны GitHub с author/committer **bekzatwr**. Email не публикуется.
Main при проверке остаётся `3d19e8e4fd92431e936fa68eb7728448a85b7105`; merge не выполнялся.

## Результат работы

До начала уже существовали Trusted Contact, durable Retry-After, Mock Gateway,
Orchestrator, Timeline/Health, Trusted Circle, SOC reports/cases, бот с 12 командами
и educational questionnaire. Они переиспользованы, не выданы за новые функции.

Добавлены отдельный приватный RU/KK text analyzer, типизированный защищённый API,
13-я команда `/scan`, кнопка меню, маскирование рабочей копии, отсутствие raw-text
persistence/echo/external AI, TTL/cancel, подготовленные frontend strings/examples,
40 собственных synthetic QA cases, baseline comparison и CI artifact.
Источники № 2/3/19 и QA № 7/20/21 разобраны в
[QA protocol](../qa/SCAM_CHECK_EVALUATION.md); чужой код, модели и данные не копировались.

Дополнительно исправлены две обнаруженные проблемы проверки:

1. Docker health мог стать healthy раньше доступности loopback HTTP на Windows.
   После старта выполняются максимум три read-only readiness прогона; операции,
   уведомления и сообщения не повторяются. Проверены recovery и исчерпание попыток.
2. Windows pytest иногда завершался с exit 0 без summary/JUnit после прогрева полного
   процесса, около migration rehearsal. Изолированные три rehearsal cases прошли.
   `verify.ps1` теперь выполняет основной набор и эти три случая в отдельных процессах,
   требует свежий непустой JUnit каждого и отказывает при отсутствии/ошибках отчёта.
   Ни один тест не исключён из суммарного покрытия. Точная причина завершения native
   процесса не установлена; это изоляция и защита от ложного PASS, не исправление ядра Python.

## Проверки

Windows: основной процесс **517 passed, 16 skipped** (533 cases), отдельный rehearsal
**3 passed**. Оба свежих JUnit отчёта завершены: всего **520 passed, 16 skipped** из 536.
15 случаев требуют внешних PostgreSQL/Redis, ещё один зависит от разрешения запуска
дочернего процесса на Windows; Linux закрывает эти пропуски. Проверены также отказы
verifier для отсутствующего, пустого, ошибочного и повреждённого JUnit.
Полный исправленный **Windows `verify.ps1` завершился ALL GREEN**, включая оба
backend процесса, 64 frontend tests, typecheck, production build и Compose configs.

На implementation/fix `342c0e5` Linux verify job прошёл: **521 passed, 15 skipped**
в portable suite и **317 passed** в PostgreSQL/Redis job. Объединение даёт
**536 уникальных прошедших backend cases** (на 66 больше исходных 470), а не 838.
Там же прошли `verify.sh`, 64 frontend tests, typecheck/build и migration round trips:
[CI run](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/44532585485).
[Operator CI](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/44532585437)
тоже завершился успешно, включая start/rehearse/stop/start и сохранение состояния.
Актуальные checks документационного HEAD доступны непосредственно в PR #16.

- Ruff: 169 Python files; strict mypy: 168 source files.
- Локальный PostgreSQL/Redis на feature implementation: **314 passed, 1 skipped**.
  Skip связан с запрещённым Windows запуском дочернего процесса; Linux CI выполняет его.
  Этот набор пересекается с portable pytest и не прибавляется к нему как новые тесты.
- Migration round trips: обе опубликованные heads → merged head → downgrade → upgrade;
  synthetic sentinel rows и ORM parity сохранены. Новых миграций в PR нет.
- Локальный Docker: все **7** сценариев прошли: normal, scam/Cooling-Off, hub,
  guardian_report, SOC case lifecycle, operations/privacy, private RU/KK scam check.
- Тот же CI для `342c0e5`: **64 frontend tests**, production build/typecheck,
  **81 browser checks**, integrations disabled regression, 7 fake Docker scenarios.
  [Первичный feature CI](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/44529015874)
  тоже прошёл. Нельзя складывать portable/PG/повторные прогоны в один счётчик.

Новый `/scan` через реальный Telegram **не проверялся**. Dispatcher tests используют
подменённый Telegram transport. Текущая работа не отправляла реальные сообщения и
не запускала polling. Историческая разрешённая приёмка прежних команд не заменяет
приёмку новой команды.

## Качество и latency

На собственной development panel из 40 сообщений: TP=16, FP=2, FN=4, TN=18;
precision 88.89%, recall 80%, FPR 10%. Keyword baseline на том же словаре/корпусе:
TP=16, FP=12, FN=4, TN=8. Это выбранные синтетические и парные RU/KK примеры,
не независимый holdout и не оценка точности в банке. Полные показатели, hash и ошибки:
[JSON evaluation](../qa/scam-check-evaluation.json).

| Измерение | Объём | p50 | p95 | p99 | Граница |
|---|---:|---:|---:|---:|---|
| Offline Scam Check | 1000 | 0.0962 ms | 0.1962 ms | 0.3002 ms | Только локальные правила; 0 exceptions |
| HTTP Scam Check | 20 после 3 warmup | 21.9924 ms | 46.4625 ms | 75.9268 ms | HTTP/auth/Redis/rules, без SQL; 0 ошибок |
| Existing antifraud benchmark | 500 | 6.5137 ms | 12.2002 ms | Не измерен этим скриптом | Реальный Redis; без HTTP/SQL |

HTTP p99 — максимум малой выборки. Рабочие нагрузки различны; эти числа не сравниваются
между собой и не доказывают ускорение проекта. Новая проверка не вызывается из
`transfers/evaluate` или `resolve-cooling`, не меняет threshold/velocity/graph/model.
Новых queue jobs в ней нет, поэтому отдельная queue latency этой функции неприменима.

Отдельно повторён existing `evaluate_fraud_model --rows 10000`: это тот же synthetic
generator, не реальные клиенты и не temporal holdout. В panel из 10 сценариев совпало
9 ожидаемых core decisions. `subtle_coercion`: ожидается `cooling_off`, получен `approved`.
Это факт для Дамира/core owner; policy и scoring не изменялись. Три основные demo presets
при этом прошли. Не подменять эту известную границу графиком высокой model-only AUC.

## Передача команде и решение о готовности

- Айдане: [API/UX contract](PRIVATE_SCAM_CHECK.md), OpenAPI и RU/KK examples. Подключать
  через доверенный backend/BFF, не размещать signing key в приложении; не логировать
  введённый текст и не показывать отсутствие сигналов как «безопасно».
- SOC: использовать фиксированные объяснения как advisory. Анализ не создаёт incident,
  не инициирует отправку сообщения и не даёт контакту прав распоряжаться переводом.
- QA: независимая RU/KK разметка новых кейсов, native-language review и отдельная live
  Telegram приёмка `/scan` после согласия. AMLSim/JVM не запускались — заимствован
  подход synthetic scenarios, а не чужой эксперимент или цифры.
- Дамиру: review PR #16 после #15 и согласованного integration stack; отдельно проверить
  `subtle_coercion`. Требуется разрешение на merge с сохранением реального авторства.
  Не squash/force-push и не переписывать авторов. Contributors обновится после разрешённого
  включения реальных commits в default branch и обновления статистики GitHub.

Старая 100-строчная матрица остаётся **99.50%: 98 DONE, D17/D18 BLOCKED**.
Новые функции не увеличивают её баллы. Это не production readiness.

**GO**: локальное синтетическое Docker demo и техническая передача API на review.
**NO-GO**: считать завершёнными merge/team acceptance, live `/scan` или production.
Приложение других участников, Android Studio проекты и финансовое ядро не переписывались.
После тестов пять собственных rehearsal containers остановлены, volumes сохранены.

## Короткое сообщение Дамиру

Бекзат: подготовил Draft PR #16 поверх #15. Добавлены приватная RU/KK проверка текста
через API и Telegram /scan, privacy guards, проверяемые frontend контракты и QA отчёт
с явными FP/FN. Финансовая логика не менялась; авторство GitHub связано с bekzatwr.
Есть семь синтетических Docker сценариев и отдельные CI проверки. Нужны review
зависимого стека, подключение UI и совместная приёмка. В core panel отдельно обнаружен
subtle_coercion → approved вместо ожидаемого cooling_off; прошу решение владельца core.
Новый /scan в реальном Telegram пока не запускался.

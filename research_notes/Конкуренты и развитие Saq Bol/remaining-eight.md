# Дополнительные 11 репозиториев: доказательства и развитие Saq Bol

## Метод и границы сравнения

### Takeaway
Проверены восемь исходных репозиториев и три добавленных: Banu190 и два SaqBol-тёзки. «Лучше во всём» из открытых репозиториев доказать нельзя: продукты решают разные задачи и используют несопоставимые данные. Исследование датировано 20 ноября 2026; чужой код не выполнялся, изменения продукта не делались.

### Cited Findings
- Локальный baseline — HEAD `de601ce7471c9026254d77da937187ad30f1ec30`. В Saq Bol inspected scorer есть rules, ML, graph, browser-context, SENDER_PASS_THROUGH и авторитетная SQL-пометка получателя; явной связи refund/original_payment в прочитанном TransferContext и scorer не найдено. [antifraud.py](../../backend/app/services/antifraud.py), [API contracts](../../docs/API_CONTRACTS.md).
- Наши разные уровни latency уже разведены: engine p95 4.90 ms, ML 0.12 ms; full HTTP + PostgreSQL 55.24 ms при c1 и 274.38 ms при c8. Это локальная синтетика и сохранённые результаты, не банковский SLA. [PERFORMANCE.md](../../docs/PERFORMANCE.md), [raw measurements](../../docs/evidence/performance-20261120.json).
- Зафиксированные GitHub SHA получены из archive comment и для трёх крупных архивов также `git ls-remote HEAD`; ссылки ниже закреплены на SHA. Даты ZIP нельзя выдавать за даты коммитов. README, source, test source, published benchmark artifact и реально пройденное demo различены. Текущий CI конкурентов не проверялся.

### Inferences
- Защищаемое преимущество нашей ветки — согласованный end-to-end путь API/BFF, реальная браузерная телеметрия, KK/RU, серверный deadline, version/idempotency-поведение операторских действий и проверка настоящих PostgreSQL/Redis. Это не основание объявлять конкурентов слабее по fraud accuracy.
- Реализация сохранения паузы между попытками, объяснение решения SOC и полное имя проекта описаны в [итоговом сравнении](../../reports/Конкуренты%20и%20развитие%20Saq%20Bol.md). Приведённые выше значения задержки относятся к срезу `de601ce` до этих изменений.

### Gaps
- Исследование не доказывает соответствие законодательству, точность на реальных банковских транзакциях, официальное партнёрство/одобрение BCC или итог конкурса. Корректная идентичность: **Saq Bol × BCC — независимый прототип для хакатона**, с ссылкой на наш репозиторий и команду.
- Веб-инструмент не открыл некоторые опубликованные demo URLs. Это ограничение доступа в этой сессии, а не доказательство, что сайты не работают. Закрытые страницы не обходились; сообщения владельцам не отправлялись.

## QORNET — `deKingsq/qornet`

### Takeaway
Сильная сторона — доказательные связи сети, маршрут денег и отдельные сценарии банкомата/P2P. У Saq Bol другой центр продукта: серверное решение перевода, ML, биометрия и жизненный цикл cooling-off; широкий ATM/P2P-marketplace сценарий QORNET нельзя приписывать нашему прототипу.

### Cited Findings
- Снимок проверен 20 ноября 2026: HEAD `d2fecae88936c4dc592070a5bdccee785502f21c`; дата ZIP 2026-11-15. Это метка архива, а не независимо подтверждённая дата последнего коммита. [Зафиксированная версия](https://github.com/deKingsq/qornet/tree/d2fecae88936c4dc592070a5bdccee785502f21c).
- В тестах проверяются ссылки причин на существующие события, сохранение хронологии цепочки, отсутствие риска от одного общего IP/VPN и отсутствие кластера устройств без финансового подтверждения. Есть отдельные проверки ATM и несовпадения участника P2P-сделки. [Источник: tests/engine.test.ts](https://github.com/deKingsq/qornet/blob/d2fecae88936c4dc592070a5bdccee785502f21c/tests/engine.test.ts)
- `transferRisk` использует уже рассчитанный риск получателя; benchmark измеряет этот короткий lookup, а не полный пересчёт графа/БД/HTTP. Его p95 нельзя напрямую сравнивать с нашим end-to-end p95. [Источник: backend/transfer-risk.ts](https://github.com/deKingsq/qornet/blob/d2fecae88936c4dc592070a5bdccee785502f21c/backend/transfer-risk.ts)
- `frontend/browser-api.ts` реализует API-подобный слой в браузере; README отдельно различает GitHub Pages-демо и локальный Express/SQLite. [Источник: frontend/browser-api.ts](https://github.com/deKingsq/qornet/blob/d2fecae88936c4dc592070a5bdccee785502f21c/frontend/browser-api.ts) [Источник: README.md](https://github.com/deKingsq/qornet/blob/d2fecae88936c4dc592070a5bdccee785502f21c/README.md)

### Inferences
- Идея «показать, почему связь доказательна» полезнее механического добавления ещё одного общего risk score. Общий IP сам по себе — слабое основание.
- Небольшой полезный шаг для Saq Bol: В инспекторе показывать конкретные транзакции, которыми подтверждается каждый графовый сигнал, и легитимный контрпример рядом с дроп-сетью.

### Gaps
- Ссылки https://dekingsq.github.io/qornet/ и /demo/ опубликованы, но web-инструмент не открыл их; визуальное качество и работоспособность live-действий независимо не подтверждены.
- Исходники и тесты прочитаны; исполнение и актуальный CI не проверялись. Наличие теста подтверждает проверяемый сценарий в репозитории, но не успешный прогон на нашей машине.

## BCC Shield / семейная защита — `RootVandal/BCCShield`

### Takeaway
Сильная сторона — связный сценарий клиента, родственника и аналитика, включая реакцию ещё во время звонка и decoy. У нас есть cooling-off, Guardian и операторская пометка получателя; автоматическую распознаваемость AnyDesk/сотовых звонков и полноценный семейный продукт из этого не следует считать реализованными.

### Cited Findings
- Снимок проверен 20 ноября 2026: HEAD `76480be74cd751e806f8e9f0293abc5aff867c08`; дата ZIP 2026-11-18. Это метка архива, а не независимо подтверждённая дата последнего коммита. [Зафиксированная версия](https://github.com/RootVandal/BCCShield/tree/76480be74cd751e806f8e9f0293abc5aff867c08).
- `context.py` вычисляет риск из неизвестного номера, длительности звонка, открытия банка и remote_app; это реализованные правила над переданными событиями, не доказательство доступа веб-приложения к реальной телефонии. [Источник: app/call_guard/context.py](https://github.com/RootVandal/BCCShield/blob/76480be74cd751e806f8e9f0293abc5aff867c08/app/call_guard/context.py)
- `decoy.py` хранит отдельный статус операции, не отправляет деньги и помечает получателя; `test_decoy.py` проверяет отсутствие движения денег, несколько пойманных карт и отсутствие приманки при обычном сценарии. [Источник: app/family/decoy.py](https://github.com/RootVandal/BCCShield/blob/76480be74cd751e806f8e9f0293abc5aff867c08/app/family/decoy.py) [Источник: tests/test_decoy.py](https://github.com/RootVandal/BCCShield/blob/76480be74cd751e806f8e9f0293abc5aff867c08/tests/test_decoy.py)
- README прямо объявляет проект независимым демо, называет телефонные события, НБК и telecom mock-источниками; для словарного слоя на собственных 12 scam-диалогах сообщает лишь 2 high и 1 medium. Это полезная честная граница, а не доказательство высокой точности. [Источник: README.md](https://github.com/RootVandal/BCCShield/blob/76480be74cd751e806f8e9f0293abc5aff867c08/README.md)

### Inferences
- Полезнее перенять ясный семейный путь и раскрытие mock-границ, чем копировать автоматическое объявление любой карты мошеннической: для пилота потребуются независимые основания и разбор ошибочной пометки.
- Небольшой полезный шаг для Saq Bol: Сделать честную панель происхождения сигнала: браузерное наблюдение, ручной demo-toggle, серверные данные, mock-внешний источник; добавлять приманку только как явно изолированную демо-функцию.

### Gaps
- Демо bcc-shield.onrender.com и видео опубликованы, но в этой проверке live-сценарий не пройден. Показатели/сравнения с коммерческими банками из README не проверялись по источникам банков и не используются как факт.
- Исходники и тесты прочитаны; исполнение и актуальный CI не проверялись. Наличие теста подтверждает проверяемый сценарий в репозитории, но не успешный прогон на нашей машине.

## NEXORA AI — `SaginbekDaniel/SYNAPTIC-LABS`

### Takeaway
Сильная сторона — причинная проверка денежной цепочки и явная недостаточность доказательств. Saq Bol уже считает fan-in/transit/shared-device сигналы; это не эквивалент capacity-constrained temporal max-flow с уровнями неоднозначности.

### Cited Findings
- Снимок проверен 20 ноября 2026: HEAD `ea5ca9c120115e068ada90c508f2d078d6b512c3`; дата ZIP 2026-11-17. Это метка архива, а не независимо подтверждённая дата последнего коммита. [Зафиксированная версия](https://github.com/SaginbekDaniel/SYNAPTIC-LABS/tree/ea5ca9c120115e068ada90c508f2d078d6b512c3).
- `layered_flow` строит два максимальных потока: строго хронологический и допускающий неопределённый порядок; учитывает ёмкость суммы, границы времени и ограничение бюджета расчёта. Возвращает supported/possible_ambiguous/contradicted/unavailable. [Источник: src/nexora/analytics/temporal/flow.py](https://github.com/SaginbekDaniel/SYNAPTIC-LABS/blob/ea5ca9c120115e068ada90c508f2d078d6b512c3/src/nexora/analytics/temporal/flow.py)
- Тесты отдельно покрывают обратную хронологию, same-day ambiguity, отсутствие повторного использования одной входящей суммы, смешение валют и лимит вычислений. [Источник: tests/unit/test_temporal_flow.py](https://github.com/SaginbekDaniel/SYNAPTIC-LABS/blob/ea5ca9c120115e068ada90c508f2d078d6b512c3/tests/unit/test_temporal_flow.py)
- `risk.py` кредитует не более одного сигнала семейства, умеет abstain без числового приоритета и ограничивает итоговый band противоречащими данными. `evidence_validation.py` пересчитывает суммы по ID исходных переводов и отклоняет несогласованное доказательство. [Источник: src/nexora/analytics/risk.py](https://github.com/SaginbekDaniel/SYNAPTIC-LABS/blob/ea5ca9c120115e068ada90c508f2d078d6b512c3/src/nexora/analytics/risk.py) [Источник: src/nexora/analytics/evidence_validation.py](https://github.com/SaginbekDaniel/SYNAPTIC-LABS/blob/ea5ca9c120115e068ada90c508f2d078d6b512c3/src/nexora/analytics/evidence_validation.py)
- README называет live-demo защищённым общей учётной записью и отделяет текущую ветку от ещё не слитого PR с дополнительными методами. Возможности открытого PR не засчитаны текущему HEAD. [Источник: README.md](https://github.com/SaginbekDaniel/SYNAPTIC-LABS/blob/ea5ca9c120115e068ada90c508f2d078d6b512c3/README.md)

### Inferences
- Это преимущество качества доказательства для расследования, а не доказательство более быстрого inline-blocking. Включать тяжёлый max-flow в наш синхронный горячий путь без отдельного замера нельзя.
- Небольшой полезный шаг для Saq Bol: Ввести в SOC короткую карточку «основания / ограничения данных», ссылку на исходные события и тест «исходящий раньше входящего не доказывает транзит».

### Gaps
- Общая demo-учётная запись не равна банковскому IAM. https://web-production-4593b103.up.railway.app требует доступ; логин не обходился. Бенчмарк JSON опубликован, независимого повторения нет.
- Исходники и тесты прочитаны; исполнение и актуальный CI не проверялись. Наличие теста подтверждает проверяемый сценарий в репозитории, но не успешный прогон на нашей машине.

## Чистый счёт — `ERA216/ITU-Hackathon`

### Takeaway
Сильная сторона — защита невольного участника схемы «ошибочный перевод → верните на другую карту», включая возврат и апелляцию. Наш SENDER_PASS_THROUGH может заметить общий транзит, но inspected TransferContext/scorer не содержит связи original_payment/refund; полное покрытие этой истории у Saq Bol не подтверждено.

### Cited Findings
- Снимок проверен 20 ноября 2026: HEAD `bf52cd54a0ff931b533cd1b80031078d01294516`; дата ZIP 2026-11-19. Это метка архива, а не независимо подтверждённая дата последнего коммита. [Зафиксированная версия](https://github.com/ERA216/ITU-Hackathon/tree/bf52cd54a0ff931b533cd1b80031078d01294516).
- SQL в `engine.py` выбирает завершённые невозвращённые входящие от незнакомцев, отличает исходного отправителя от третьего лица, сравнивает сумму и учитывает дробление. Льгота для возврата тому же отправителю ограничена суммой поступления. [Источник: app/engine.py](https://github.com/ERA216/ITU-Hackathon/blob/bf52cd54a0ff931b533cd1b80031078d01294516/app/engine.py)
- Тесты покрывают одноразовый возврат, резерв денег, отказ при недостатке остатка, жалобу по цепочке, приостановку только спорной суммы у невольного участника, апелляцию, нового blacklist-получателя при release и запрет превышать исходный ущерб. Есть тест второго сотрудника для крупного возврата. [Источник: tests/test_flow.py](https://github.com/ERA216/ITU-Hackathon/blob/bf52cd54a0ff931b533cd1b80031078d01294516/tests/test_flow.py)
- README описывает телефон клиента, очередь аналитика, граф дела и тур из десяти шагов; проект прямо назван прототипом BCC-кейса ITU. [Источник: README.md](https://github.com/ERA216/ITU-Hackathon/blob/bf52cd54a0ff931b533cd1b80031078d01294516/README.md)
- Прочитанный `main.py` реализует клиентские и analyst-маршруты жалоб/возвратов, а не только интерактивную картинку. [Источник: app/main.py](https://github.com/ERA216/ITU-Hackathon/blob/bf52cd54a0ff931b533cd1b80031078d01294516/app/main.py)

### Inferences
- Это конкретный функциональный пробел нашего MVP. При этом объём workflow в одном SQLite-прототипе не доказывает реальную банковскую проводку, полномочия на блокировку или устойчивость на нагрузке.
- Небольшой полезный шаг для Saq Bol: Сначала добавить проверяемый сценарий входящий→попытка пересылки→безопасная рекомендация обратиться в банк. Настоящий возврат строить только позже на авторитетной связи с исходным платежом и ledger, не подменять UI-плашкой.

### Gaps
- У проекта не найден публичный URL функционального live-демо в прочитанном README; исходники не запускались. Авторская дата patch HEAD: 19 ноября 2026 17:23:37 +0500; это точнее слова «вчера», но не дата всего проекта.
- Исходники и тесты прочитаны; исполнение и актуальный CI не проверялись. Наличие теста подтверждает проверяемый сценарий в репозитории, но не успешный прогон на нашей машине.

## BCC Adapt — web-витрина — `ShadowNoYami/bcc-adapt-2026`

### Takeaway
Сильная сторона — интерактивная демонстрация доступности интерфейса. Это смежный accessibility-кейс, а не полноценный конкурент транзакционному антифроду Saq Bol.

### Cited Findings
- Снимок проверен 20 ноября 2026: HEAD `f928c0edd9d6c21bd0106365a25af5c6df403cf0`; дата ZIP 2026-11-18. Это метка архива, а не независимо подтверждённая дата последнего коммита. [Зафиксированная версия](https://github.com/ShadowNoYami/bcc-adapt-2026/tree/f928c0edd9d6c21bd0106365a25af5c6df403cf0).
- README называет сайт независимой конкурсной работой Жамбылского политехнического высшего колледджа; опубликован GitHub Pages. [Источник: README.md](https://github.com/ShadowNoYami/bcc-adapt-2026/blob/f928c0edd9d6c21bd0106365a25af5c6df403cf0/README.md)
- `Accessibility.tsx` реализует профиль масштаба/контраста/плотности; `Transfer.tsx` использует локальные draft/review/done состояния, сумму прописью и шаг подтверждения. Это проверенный UI-код, не backend-перевод. [Источник: src/Accessibility.tsx](https://github.com/ShadowNoYami/bcc-adapt-2026/blob/f928c0edd9d6c21bd0106365a25af5c6df403cf0/src/Accessibility.tsx) [Источник: src/Transfer.tsx](https://github.com/ShadowNoYami/bcc-adapt-2026/blob/f928c0edd9d6c21bd0106365a25af5c6df403cf0/src/Transfer.tsx)

### Inferences
- Сравнивать удобство отдельных шагов уместно, ранжировать этот сайт по качеству fraud detection — нет. Совпадающий владелец двух BCC Adapt не означает два независимых конкурента.
- Небольшой полезный шаг для Saq Bol: Перенять ручные настройки размера/контраста и проверку суммы прописью; не выводить мошенничество из медленного ввода пожилого пользователя.

### Gaps
- https://shadownoyami.github.io/bcc-adapt-2026/ недоступен web-инструменту в этой сессии; контраст и screen reader вручную не измерялись. Полного backend/test evidence в прочитанной структуре нет.
- Исходники интерактивного макета прочитаны; функциональное live-демо не проверено. Наличие теста подтверждает проверяемый сценарий в репозитории, но не успешный прогон на нашей машине.

## BCC Adapt — Flutter MVP — `ShadowNoYami/BCC-Adapt`

### Takeaway
Сильная сторона — адаптация к системным accessibility-настройкам, тремору и голосовому вводу RU/KK. Это мобильный accessibility-MVP того же владельца; у Saq Bol фокус на защите и SOC, а полноценного adaptive native banking профиля нет.

### Cited Findings
- Снимок проверен 20 ноября 2026: HEAD `a5028557f413536a54fa2459edd69f2c22d7fa0f`; дата ZIP 2026-11-18. Это метка архива, а не независимо подтверждённая дата последнего коммита. [Зафиксированная версия](https://github.com/ShadowNoYami/BCC-Adapt/tree/a5028557f413536a54fa2459edd69f2c22d7fa0f).
- `AccessibilityRulesEngine` детерминированно учитывает системные флаги, калибровку, моторный и когнитивный режимы, запрещая второй TTS поверх TalkBack/VoiceOver. [Источник: lib/core/accessibility/domain/accessibility_rules_engine.dart](https://github.com/ShadowNoYami/BCC-Adapt/blob/a5028557f413536a54fa2459edd69f2c22d7fa0f/lib/core/accessibility/domain/accessibility_rules_engine.dart)
- `core_engine_test.dart` проверяет масштаб 1.0–2.0, contrast ratio ≥7:1 для выбранных палитр, RU/KK voice parser, сумму прописью и запрет двойной озвучки. Это узкие проверки токенов/логики, не сертификация всего приложения WCAG AAA. [Источник: test/core_engine_test.dart](https://github.com/ShadowNoYami/BCC-Adapt/blob/a5028557f413536a54fa2459edd69f2c22d7fa0f/test/core_engine_test.dart)
- `transfer_screen.dart` содержит отдельный confirmation flow и управление голосовым черновиком; в структуре есть `mock_bank_repository.dart`, а README описывает MVP. [Источник: lib/features/banking/presentation/transfer_screen.dart](https://github.com/ShadowNoYami/BCC-Adapt/blob/a5028557f413536a54fa2459edd69f2c22d7fa0f/lib/features/banking/presentation/transfer_screen.dart) [Источник: README.md](https://github.com/ShadowNoYami/BCC-Adapt/blob/a5028557f413536a54fa2459edd69f2c22d7fa0f/README.md)

### Inferences
- Паузы/удаления в нашей биометрии нельзя трактовать как доказательство принуждения без контекста: особенности моторики дают похожее поведение. Нужны легитимные accessibility-контрпримеры.
- Небольшой полезный шаг для Saq Bol: Добавить регрессии keyboard-only, screen-reader, крупного текста и исключить двойную озвучку; альтернативный ввод должен сохранять самостоятельное подтверждение суммы и получателя.

### Gaps
- APK/iOS-сборка не запускалась; заявления об отсутствии layout overflow и полной доступности независимо не воспроизводились.
- Исходники и тесты прочитаны; исполнение и актуальный CI не проверялись. Наличие теста подтверждает проверяемый сценарий в репозитории, но не успешный прогон на нашей машине.

## Zero Scam Shield / Trust Provenance — `athiphat67/zero-scam-shield`

### Takeaway
Сильная сторона — история выстраивания доверия до самого большого платежа и честный экспериментальный протокол. Это NITMX Fintech Bootcamp, не ITU/BCC; Saq Bol пока показывает текущий риск и общую velocity, а не отдельный эксперимент early-warning по эпизодам grooming.

### Cited Findings
- Снимок проверен 20 ноября 2026: HEAD `e57e0a8a51fe1e378f408423980df1ae65989615`; дата ZIP 2026-11-18. Это метка архива, а не независимо подтверждённая дата последнего коммита. [Зафиксированная версия](https://github.com/athiphat67/zero-scam-shield/tree/e57e0a8a51fe1e378f408423980df1ae65989615).
- `features.py` считает признаки только по событиям строго до t: возраст связи, увеличение суммы, возвратные выплаты, новые кластеры контрагентов, лестницу платежей; missing означает None, не ноль. [Источник: src/tp/features.py](https://github.com/athiphat67/zero-scam-shield/blob/e57e0a8a51fe1e378f408423980df1ae65989615/src/tp/features.py)
- Тесты проверяют point-in-time, score-before-update и раздельность escalation от money-back признаков. [Источник: tests/test_features.py](https://github.com/athiphat67/zero-scam-shield/blob/e57e0a8a51fe1e378f408423980df1ae65989615/tests/test_features.py)
- Опубликованный G0 lab report прямо обозначает синтетический источник и сообщает не только успехи: основная прибавка TRUST к generic неубедительна, доверительный интервал пересекает ноль; встречаются проваленные гипотезы и hard-negative группы. [Источник: reports/G0_LAB_REPORT.md](https://github.com/athiphat67/zero-scam-shield/blob/e57e0a8a51fe1e378f408423980df1ae65989615/reports/G0_LAB_REPORT.md)
- Контекст NITMX и заявление о finalist Top15 — сведения автора README, не подтверждённый нами официальный результат конкурса. [Источник: README.md](https://github.com/athiphat67/zero-scam-shield/blob/e57e0a8a51fe1e378f408423980df1ae65989615/README.md)

### Inferences
- Главное заимствование — способ честной проверки пользы новой фичи при одинаковом бюджете ложных тревог. Название ML-признака или высокий synthetic recall сами по себе не доказывают предотвращённые потери.
- Небольшой полезный шаг для Saq Bol: Добавить небольшой замороженный набор «маленькая выплата → возрастающие платежи» с честными семейными/торговыми аналогами и метрикой предупреждения до максимальной потери.

### Gaps
- Нет проверки на банковских данных или независимого повторения. Числа из их synthetic replay нельзя сопоставлять с нашим engine latency или переводить в «процент реальных мошенников».
- Исходники и тесты прочитаны; исполнение и актуальный CI не проверялись. Наличие теста подтверждает проверяемый сценарий в репозитории, но не успешный прогон на нашей машине.

## Shurokkha — `mohammadyaksafu/DIU_Hackathon_final`

### Takeaway
Сильная сторона — управляемое внедрение модели: shadow/warn/enforce, policy и развёрнутый evidence pack. Это Bangladesh/upay, другой конкурс. Наш технический demo/pilot gate не равен реализованной продуктовой последовательности shadow→warn→enforce.

### Cited Findings
- Снимок проверен 20 ноября 2026: HEAD `cfd3703333f40b2899129cbb834aee80b1a1c7c3`; дата ZIP 2026-10-10. Это метка архива, а не независимо подтверждённая дата последнего коммита. [Зафиксированная версия](https://github.com/mohammadyaksafu/DIU_Hackathon_final/tree/cfd3703333f40b2899129cbb834aee80b1a1c7c3).
- `policy/engine.py` и policy.yaml различают фактическое решение и действие для клиента в shadow/warn/enforce, ограничивают runtime policy; unit-тесты проверяют все три режима и сохранение прежней конфигурации при сломанном edit. [Источник: backend/app/policy/engine.py](https://github.com/mohammadyaksafu/DIU_Hackathon_final/blob/cfd3703333f40b2899129cbb834aee80b1a1c7c3/backend/app/policy/engine.py) [Источник: backend/config/policy.yaml](https://github.com/mohammadyaksafu/DIU_Hackathon_final/blob/cfd3703333f40b2899129cbb834aee80b1a1c7c3/backend/config/policy.yaml) [Источник: backend/tests/test_units.py](https://github.com/mohammadyaksafu/DIU_Hackathon_final/blob/cfd3703333f40b2899129cbb834aee80b1a1c7c3/backend/tests/test_units.py)
- Тесты проверяют point-in-time features, общую Redis state между workers, reason codes только при истинном сигнале, merchant-aware graph и паритет оптимизированного IsolationForest. Это наличие конкретных проверок, не наш успешный прогон. [Источник: backend/tests/test_units.py](https://github.com/mohammadyaksafu/DIU_Hackathon_final/blob/cfd3703333f40b2899129cbb834aee80b1a1c7c3/backend/tests/test_units.py)
- `services/scoring.py` отделяет score от committed-transfer ingestion и release. DISCLOSURES говорит, что ML обучен на синтетических данных. [Источник: backend/app/services/scoring.py](https://github.com/mohammadyaksafu/DIU_Hackathon_final/blob/cfd3703333f40b2899129cbb834aee80b1a1c7c3/backend/app/services/scoring.py) [Источник: DISCLOSURES.md](https://github.com/mohammadyaksafu/DIU_Hackathon_final/blob/cfd3703333f40b2899129cbb834aee80b1a1c7c3/DISCLOSURES.md)
- Отчёт evaluation публикует ablation/threshold evidence; README раскрывает слабые unseen-family сценарии, а не только общую headline-метрику. Авторские latency/accuracy/award claims независимо не воспроизводились. [Источник: docs/reports/evaluation.md](https://github.com/mohammadyaksafu/DIU_Hackathon_final/blob/cfd3703333f40b2899129cbb834aee80b1a1c7c3/docs/reports/evaluation.md) [Источник: README.md](https://github.com/mohammadyaksafu/DIU_Hackathon_final/blob/cfd3703333f40b2899129cbb834aee80b1a1c7c3/README.md)

### Inferences
- Сильная идея — снижать риск внедрения и показывать цену ошибочной блокировки. Копирование Bangla/English или конкретных правил upay в Казахстан без переоценки неприменимо.
- Небольшой полезный шаг для Saq Bol: Определить shadow policy как отдельный режим с сохранением исходного решения и наблюдаемого результата; добавить семейства unseen-fraud и сегментные false positives в offline evaluation.

### Gaps
- Опубликованный live https://165-99-219-251.sslip.io не открылся web-инструментом; видео не просмотрено. Авторское Champion-заявление не проверялось у организатора. Юридическая/банковская готовность из кода не следует.
- Исходники и тесты прочитаны; исполнение и актуальный CI не проверялись. Наличие теста подтверждает проверяемый сценарий в репозитории, но не успешный прогон на нашей машине.

## Fraud Replay — каркас — `Banu190/-ITU-hackathon`

### Takeaway
В репозитории есть каркас, но доступных свидетельств работающего продукта пока нет. Не следует называть его буквально пустым либо полноценным конкурентом Saq Bol.

### Cited Findings
- Снимок проверен 20 ноября 2026: HEAD `5177f05401e9f0e8519c8aa76f4be9c0ea02d06b`; дата ZIP 2026-11-17. Это метка архива, а не независимо подтверждённая дата последнего коммита. [Зафиксированная версия](https://github.com/Banu190/-ITU-hackathon/tree/5177f05401e9f0e8519c8aa76f4be9c0ea02d06b).
- GitHub указывает создание репозитория 17.11.2026 в 14:49:11 UTC. [Метаданные](https://api.github.com/repos/Banu190/-ITU-hackathon). Зафиксированный архив содержит 11 файлов: `fraud-replay/README.md`, `backend/main.py` и .gitkeep в database/fraud_engine/routes/frontend/data/tests/presentation. Проверенные README и main.py имеют нулевое содержимое. [Источник: fraud-replay/README.md](https://github.com/Banu190/-ITU-hackathon/blob/5177f05401e9f0e8519c8aa76f4be9c0ea02d06b/fraud-replay/README.md) [Источник: fraud-replay/backend/main.py](https://github.com/Banu190/-ITU-hackathon/blob/5177f05401e9f0e8519c8aa76f4be9c0ea02d06b/fraud-replay/backend/main.py)
- `tests/.gitkeep` обозначает папку, но не проверяемый тест. [Источник: fraud-replay/tests/.gitkeep](https://github.com/Banu190/-ITU-hackathon/blob/5177f05401e9f0e8519c8aa76f4be9c0ea02d06b/fraud-replay/tests/.gitkeep)

### Inferences
- Гипотеза Fraud Replay понятна только из названия каталога; особенности алгоритма/команды/связь с BCC не установлены.
- Небольшой полезный шаг для Saq Bol: Ничего не копировать по одному имени папки; пересматривать только при появлении реализации или демонстрации.

### Gaps
- Нельзя оценить UX, движок, качество или конкурсную заявку; отсутствие наблюдаемой реализации не означает отсутствие приватной работы команды.
- Каркас из 11 файлов; проверенные main.py и README пустые, tests/.gitkeep. Наличие теста подтверждает проверяемый сценарий в репозитории, но не успешный прогон на нашей машине.

## SaqBol — текстовый checker — `InfectedDuck/SaqBol`

### Takeaway
Сильная сторона — объяснения точными фрагментами текста, приватность и честный ответ «не уверен». Это отдельный репозиторий другого владельца о text scam detection, не наш Saq Bol × BCC transaction/SOC prototype; принадлежность нашей команде ничем не подтверждена.

### Cited Findings
- Снимок проверен 20 ноября 2026: HEAD `85796d387b521ad03f4c3debf4a2e437f92c35b4`; дата ZIP 2026-11-10. Это метка архива, а не независимо подтверждённая дата последнего коммита. [Зафиксированная версия](https://github.com/InfectedDuck/SaqBol/tree/85796d387b521ad03f4c3debf4a2e437f92c35b4).
- `core/fuse.py` объединяет rules/model и при значительном несогласии возвращает UNSURE; проверяет соответствие evidence spans исходному тексту. Тесты покрывают disagreement, hard negatives и запрет выдуманных фрагментов. [Источник: src/saqbol/core/fuse.py](https://github.com/InfectedDuck/SaqBol/blob/85796d387b521ad03f4c3debf4a2e437f92c35b4/src/saqbol/core/fuse.py) [Источник: tests/test_fuse.py](https://github.com/InfectedDuck/SaqBol/blob/85796d387b521ad03f4c3debf4a2e437f92c35b4/tests/test_fuse.py)
- Privacy-тесты проверяют маскирование телефонов, ИИН, карт, e-mail/IBAN с сохранением сумм и коротких кодов, а также идемпотентность очистки. [Источник: tests/test_privacy.py](https://github.com/InfectedDuck/SaqBol/blob/85796d387b521ad03f4c3debf4a2e437f92c35b4/tests/test_privacy.py)
- README прямо сообщает work in progress, отсутствие public deployment и оценённой модели; заявляет четыре языка, а не банковский transfer ledger. [Источник: README.md](https://github.com/InfectedDuck/SaqBol/blob/85796d387b521ad03f4c3debf4a2e437f92c35b4/README.md)

### Inferences
- Это полезный пример объяснимости и границ продукта, но его показатели нельзя приписывать нашей модели или считать direct bank benchmark. Совпадение общеупотребительного «Сақ бол» требует ясной идентичности.
- Небольшой полезный шаг для Saq Bol: Явно показывать полное имя команды/репозитория и независимый статус; при будущем анализе сообщений использовать цитируемые evidence spans и состояние недостаточной уверенности.

### Gaps
- Независимая оценка ML отсутствует по собственному README. Dataset/test fixtures и реализация не равны подтверждённой полевой точности; публичного live-демо не заявлено.
- Исходники и тесты прочитаны; исполнение и актуальный CI не проверялись. Наличие теста подтверждает проверяемый сценарий в репозитории, но не успешный прогон на нашей машине.

## Сақ бол — tryHard — `itsaibarr/saq-bol`

### Takeaway
Сильная сторона — опубликованная оценка на реальных публичных текстах с RU/KK разбивкой и раскрытыми ограничениями. Это отдельный text/call-transcript классификатор команды tryHard; банковские транзакции, velocity и SOC-исполнение не являются его заявленным центром.

### Cited Findings
- Снимок проверен 20 ноября 2026: HEAD `e8b0237642afe3713bae715b4eea2976fcbc28bf`; дата ZIP 2026-11-15. Это метка архива, а не независимо подтверждённая дата последнего коммита. [Зафиксированная версия](https://github.com/itsaibarr/saq-bol/tree/e8b0237642afe3713bae715b4eea2976fcbc28bf).
- JSON `final_report_testC` содержит frozen threshold, temperature, recall/FPR и интервалы. Заявленный итог: 136/151 KZ scam texts, 42/48 KK и 94/103 RU; это опубликованный артефакт автора, а не наш повторный эксперимент. [Источник: runs/kg_e5L_v8b_s1/final_report_testC.json](https://github.com/itsaibarr/saq-bol/blob/e8b0237642afe3713bae715b4eea2976fcbc28bf/runs/kg_e5L_v8b_s1/final_report_testC.json)
- SPEC документирует изменения протокола, две спорные тестовые записи, отсутствие второго независимого аннотатора test C и очень малую выборку настоящих service SMS. Это ограничивает обобщение headline 90%. [Источник: SPEC.md](https://github.com/itsaibarr/saq-bol/blob/e8b0237642afe3713bae715b4eea2976fcbc28bf/SPEC.md)
- `app.py` реализует Gradio для текста и диалога; README сам называет call mode demo из-за отсутствия реальных call transcripts и указывает команду tryHard. [Источник: app.py](https://github.com/itsaibarr/saq-bol/blob/e8b0237642afe3713bae715b4eea2976fcbc28bf/app.py) [Источник: README.md](https://github.com/itsaibarr/saq-bol/blob/e8b0237642afe3713bae715b4eea2976fcbc28bf/README.md)

### Inferences
- Полезный стандарт отчётности: отдельно показать KK, RU, легитимные банковские сообщения, реальные и синтетические наборы, счётчики ошибок и доверительные интервалы.
- Небольшой полезный шаг для Saq Bol: Сформировать независимый holdout и языковые контрпримеры для наших клиентских предупреждений; не переносить показатели чужого text classifier на transaction antifraud.

### Gaps
- Вес модели 1.1GB и опубликованный HuggingFace-ссылка не доказывают пригодность для нашего <15ms engine budget. Модель не скачивалась/не запускалась; official affiliation и членство в нашей команде не подтверждены.
- Исходники, протокол и JSON результатов прочитаны; модель не запускалась. Наличие теста подтверждает проверяемый сценарий в репозитории, но не успешный прогон на нашей машине.

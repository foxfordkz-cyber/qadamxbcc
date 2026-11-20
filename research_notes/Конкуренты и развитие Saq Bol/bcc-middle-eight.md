# Восемь проектов антифрода и четыре смежных решения: сопоставление с Saq Bol

## Вопрос 1. Что действительно реализовано у восьми основных проектов?

### Вывод

Проверено 20 ноября 2026 года. Снимки ниже получены из GitHub; исследование включает чтение README, дерева файлов и представительных исходников. Чужой код не запускался, работа публичных демо не проверялась. «Тесты есть» означает наличие и чтение тестовых файлов, а не независимое подтверждение их прохождения. Нельзя сравнивать опубликованные синтетические метрики как результаты общего банковского бенчмарка: наборы, определения и пороги различаются.

### Подтвержденные находки

**1. Ibrakazah/qorgan — прямой BCC-кейс, наиболее интересен политикой решения и демонстрацией ролей.** Снимок `25a6ea63d4940bb3f45cba5b750bf221d34e0fc7`, коммит 18.11.2026 12:28:28 UTC. [Коммит](https://github.com/Ibrakazah/qorgan/commit/25a6ea63d4940bb3f45cba5b750bf221d34e0fc7).

- Риск — прозрачная сумма правил: звонок, удаленный доступ, отклонение суммы, опустошение остатка, новый получатель, дробление переводов за сутки, fan-in, быстрый вывод, банковский стоп-лист. Доверие знакомому получателю снижает риск только без давления и нетипичной суммы. Причины сгруппированы по источнику. [risk.py](https://github.com/Ibrakazah/qorgan/blob/25a6ea63d4940bb3f45cba5b750bf221d34e0fc7/app/qorgan/risk.py).
- AI не может снять удержание при признаках дропа, давления или высоком балле; признание инструктажа и неопределенный ответ тоже ведут к удержанию. Это читаемый инвариант кода, не только обещание README. [policy.py](https://github.com/Ibrakazah/qorgan/blob/25a6ea63d4940bb3f45cba5b750bf221d34e0fc7/app/qorgan/policy.py).
- UI построен как три роли рядом: телефон, доверенное лицо, аналитик; светлые зеленые поверхности, очередь кейсов, вклад причин. В CSS есть адаптация колонок, но качество мобильного рендеринга отдельно не проверялось. [app.html](https://github.com/Ibrakazah/qorgan/blob/25a6ea63d4940bb3f45cba5b750bf221d34e0fc7/app/static/app.html).
- Есть серверная логика и тесты переходов/политики. README прямо отмечает синтетику, ручные переключатели телефонных сигналов и отсутствие нагрузочного испытания. Заявленные результаты eval — авторские. [service.py](https://github.com/Ibrakazah/qorgan/blob/25a6ea63d4940bb3f45cba5b750bf221d34e0fc7/app/qorgan/service.py), [тесты](https://github.com/Ibrakazah/qorgan/blob/25a6ea63d4940bb3f45cba5b750bf221d34e0fc7/tests/test_qorgan.py), [README](https://github.com/Ibrakazah/qorgan/blob/25a6ea63d4940bb3f45cba5b750bf221d34e0fc7/README.md).

**2. alinaraevali18/qorgan-antifraud — прямой BCC-кейс, сильная исследовательская упаковка ML.** Снимок `019c7a2d4736c97b6b0fff42394815e5773522fe`, 19.11.2026 10:53:59 UTC. [Коммит](https://github.com/alinaraevali18/qorgan-antifraud/commit/019c7a2d4736c97b6b0fff42394815e5773522fe).

- Реально присутствует `HistGradientBoostingClassifier` с весами классов, пороги выбираются по квантилям оценок честных примеров. Объяснение — собственное приближение Шепли относительно медианного честного перевода, 64 перестановки; это не дешевый одиночный predict и не основание предполагать latency <15 ms. [model.py](https://github.com/alinaraevali18/qorgan-antifraud/blob/019c7a2d4736c97b6b0fff42394815e5773522fe/qorgan/model.py).
- Графовый анализ сочетает долю рискованных входящих, быстрый дальнейший перевод, число отправителей и возраст счета; затем учитывает приток от уже подозрительных счетов и ищет связанные сети. [graph.py](https://github.com/alinaraevali18/qorgan-antifraud/blob/019c7a2d4736c97b6b0fff42394815e5773522fe/qorgan/graph.py).
- Клиентские тексты RU/KZ выбираются по предполагаемой схеме; README описывает Streamlit-экраны клиента, мониторинга, дроп-радара и модели. Заявлены временное разделение обучения/теста и синтетические данные; присутствуют pipeline-тесты. Полноценный банковский журнал исполнения по этим материалам не установлен. [policy.py](https://github.com/alinaraevali18/qorgan-antifraud/blob/019c7a2d4736c97b6b0fff42394815e5773522fe/qorgan/policy.py), [README](https://github.com/alinaraevali18/qorgan-antifraud/blob/019c7a2d4736c97b6b0fff42394815e5773522fe/README.md), [tests](https://github.com/alinaraevali18/qorgan-antifraud/blob/019c7a2d4736c97b6b0fff42394815e5773522fe/tests/test_pipeline.py).

**3. MaratelloMaJo/bcc-shield-360 — прямой BCC-кейс, наиболее широкий набор клиентских демонстраций.** Снимок `46588a22d767086c57631d71b864e5d31c8bd8d1`, 18.11.2026 13:18:31 UTC. [Коммит](https://github.com/MaratelloMaJo/bcc-shield-360/commit/46588a22d767086c57631d71b864e5d31c8bd8d1).

- В едином React-экране есть мобильный банк, пульт сценариев, SafeCall, семейное согласование, TrustLens, сканер сообщений; переводные состояния сохраняются в localStorage. Демонстрационные события звонка и семейные действия не равны интеграции с ОС/банком. [page.tsx](https://github.com/MaratelloMaJo/bcc-shield-360/blob/46588a22d767086c57631d71b864e5d31c8bd8d1/app/page.tsx).
- Проверка текста имеет детерминированные триггеры, маскирование ИИН/PAN и необязательное дополнение OpenAI. Сервер передает модели замаскированный текст; итоговый балл не снижается ниже правил. Таймаут 9 секунд и fallback сохраняют доступность анализа, но этот endpoint не подходит в быстрый transfer critical path. [scam-engine.ts](https://github.com/MaratelloMaJo/bcc-shield-360/blob/46588a22d767086c57631d71b864e5d31c8bd8d1/lib/scam-engine.ts), [route.ts](https://github.com/MaratelloMaJo/bcc-shield-360/blob/46588a22d767086c57631d71b864e5d31c8bd8d1/app/api/scam-analyze/route.ts).
- README раскрывает демонстрационный HMAC-ключ; криптографическая арифметика в браузере не подтверждает доверенную банковскую подпись. Экспорт с названием NBK-формата не доказывает согласованный национальный протокол. Автотестов в изученном дереве не найдено; это ограниченный вывод по снимку. [README](https://github.com/MaratelloMaJo/bcc-shield-360/blob/46588a22d767086c57631d71b864e5d31c8bd8d1/README.md), [дерево](https://github.com/MaratelloMaJo/bcc-shield-360/tree/46588a22d767086c57631d71b864e5d31c8bd8d1).

**4. wiwiq009/bcc-qorgau — смежный анализ сообщений, банковский transfer lifecycle не подтвержден.** Снимок `a371dcb5fc5aa7f2181f5e0ff72c75dbf2ffec28`, 19.11.2026 15:43:45 UTC. [Коммит](https://github.com/wiwiq009/bcc-qorgau/commit/a371dcb5fc5aa7f2181f5e0ff72c75dbf2ffec28).

- Flask `/api/analyze` суммирует регулярные выражения: секретные данные, срочность, ссылки, переводы, выгода, угрозы. Есть русские и казахские паттерны; низкий результат прямо не обещает безопасность. Обученной модели, графа и исполнения переводов в просмотренном сервере нет. [app.py](https://github.com/wiwiq009/bcc-qorgau/blob/a371dcb5fc5aa7f2181f5e0ff72c75dbf2ffec28/app.py).
- UI — страница проверки с результатом и советом; пригодная идея — показывать совпавшие фразы рядом с конкретной причиной, а не только процент. Защита SOC/банковский аудит и тестовая доказательность не установлены; README практически пуст. [index.html](https://github.com/wiwiq009/bcc-qorgau/blob/a371dcb5fc5aa7f2181f5e0ff72c75dbf2ffec28/templates/index.html), [README](https://github.com/wiwiq009/bcc-qorgau/blob/a371dcb5fc5aa7f2181f5e0ff72c75dbf2ffec28/README.md).

**5. mzhks01/BCC-SAFE-GUARD — локальный учебный демонстратор.** Снимок `069eb7cddaf8c513915d460f686476fbd7cf0d5b`, 15.11.2026 16:49:17 UTC. [Коммит](https://github.com/mzhks01/BCC-SAFE-GUARD/commit/069eb7cddaf8c513915d460f686476fbd7cf0d5b).

- Один HTML содержит ручной анализ текста/описания звонка, проверку переводов, эвристический score и журнал в localStorage до 40 записей. Есть экранные вкладки и компактные карточки; основные кнопки красные, поэтому это не образец аутентичного BCC emerald UI. [index.html](https://github.com/mzhks01/BCC-SAFE-GUARD/blob/069eb7cddaf8c513915d460f686476fbd7cf0d5b/index.html).
- README честно исключает чтение SMS, прослушивание, настоящую блокировку карт и официальную принадлежность банку. Не следует считать это банковским backend или антифрод-сетью. [README.txt](https://github.com/mzhks01/BCC-SAFE-GUARD/blob/069eb7cddaf8c513915d460f686476fbd7cf0d5b/README.txt).

**6. ramazanabdimalik/ITU-HACKATHON — прямой BCC-кейс, дисциплинированный интерфейс правил.** Снимок `b83455e56fc340cc5288719b20c62b53bf3a429c`, 16.11.2026 06:59:26 UTC. [Коммит](https://github.com/ramazanabdimalik/ITU-HACKATHON/commit/b83455e56fc340cc5288719b20c62b53bf3a429c).

- Чистая TypeScript-функция учитывает персональную норму суммы/времени, устройство, нового получателя, частоту всех попыток и дробление возле порога. Отмеченный получатель задает минимум 85 независимо от суммы. Есть тесты граничных условий и неизменности входа. [risk-engine.ts](https://github.com/ramazanabdimalik/ITU-HACKATHON/blob/b83455e56fc340cc5288719b20c62b53bf3a429c/web/lib/risk-engine.ts), [tests](https://github.com/ramazanabdimalik/ITU-HACKATHON/blob/b83455e56fc340cc5288719b20c62b53bf3a429c/web/lib/risk-engine.test.ts).
- Next.js-экраны Home/Transfer/Dashboard, Inter с кириллицей, мобильная нижняя навигация, drawer аналитика, RU/KK. Автор описывает keyboard/reduced-motion/error QA; независимо не воспроизводилось. База операций и решения аналитика демонстрационно объединяются с localStorage, а не банковской БД. [README](https://github.com/ramazanabdimalik/ITU-HACKATHON/blob/b83455e56fc340cc5288719b20c62b53bf3a429c/README.md), [store.ts](https://github.com/ramazanabdimalik/ITU-HACKATHON/blob/b83455e56fc340cc5288719b20c62b53bf3a429c/web/lib/store.ts), [dashboard](https://github.com/ramazanabdimalik/ITU-HACKATHON/blob/b83455e56fc340cc5288719b20c62b53bf3a429c/web/components/bank/dashboard.tsx).

**7. Mirafil/ScamGuard-KZ — образовательный pre-transfer MVP; конкретная принадлежность BCC-кейсу из прочитанного не установлена.** Снимок `8da678bcb204cfbcc973efe9ba16888e8d6949ee`, 15.10.2026 14:16:49 UTC. [Коммит](https://github.com/Mirafil/ScamGuard-KZ/commit/8da678bcb204cfbcc973efe9ba16888e8d6949ee).

- Статический конструктор операций, историческая карта и Validation Lab сопровождаются Python API: правила, валидация, X-API-Key, ограничение частоты и SQLite-аудит. Это полезное разделение учебной витрины и защищаемого API, но не доказанный банковский сервис. [server.py](https://github.com/Mirafil/ScamGuard-KZ/blob/8da678bcb204cfbcc973efe9ba16888e8d6949ee/server.py), [index.html](https://github.com/Mirafil/ScamGuard-KZ/blob/8da678bcb204cfbcc973efe9ba16888e8d6949ee/index.html).
- Сохраненный отчет на 600 синтетических примерах честно показывает TP=88, FP=171, FN=40, TN=301. README не называет правила обученной AI-моделью. Ценная идея — показывать стоимость ложных тревог рядом с найденным риском. Набор не независимая банковская валидация; тесты существуют, здесь не запускались. [отчет](https://github.com/Mirafil/ScamGuard-KZ/blob/8da678bcb204cfbcc973efe9ba16888e8d6949ee/results/synthetic_metrics_threshold40.json), [tests](https://github.com/Mirafil/ScamGuard-KZ/blob/8da678bcb204cfbcc973efe9ba16888e8d6949ee/tests/test_validation.py), [README](https://github.com/Mirafil/ScamGuard-KZ/blob/8da678bcb204cfbcc973efe9ba16888e8d6949ee/README.md).

**8. meirz911/qorgau-ai — прямой FinTech-антифрод, интересен обратной связью и потоковой демонстрацией.** Снимок `65d1ffb6482901cf730717a10e5fa5a0d14a7443`, 18.11.2026 16:42:01 UTC. [Коммит](https://github.com/meirz911/qorgau-ai/commit/65d1ffb6482901cf730717a10e5fa5a0d14a7443).

- В коде реально сочетаются правила, собственный Isolation Forest, логистическая модель и текстовый классификатор. Признаки включают сумму относительно нормы, частоту, возраст счета, fan-in и контекст. Поток на старый счет получает меньший вес, чем молодой счет с множеством отправителей. Решение аналитика добавляет получателя в blacklist и сразу дообучает модель. [risk.js](https://github.com/meirz911/qorgau-ai/blob/65d1ffb6482901cf730717a10e5fa5a0d14a7443/engine/risk.js), [supervised.js](https://github.com/meirz911/qorgau-ai/blob/65d1ffb6482901cf730717a10e5fa5a0d14a7443/engine/supervised.js), [isoforest.js](https://github.com/meirz911/qorgau-ai/blob/65d1ffb6482901cf730717a10e5fa5a0d14a7443/engine/isoforest.js).
- Есть клиентский экран, SOC и SSE-поток; backend использует in-memory состояние. В прочитанном HTTP dispatcher нет проверки идентичности оператора перед handlers. Это не полный security audit, но достаточная причина не переносить такую модель доступа в пилот. [server.js](https://github.com/meirz911/qorgau-ai/blob/65d1ffb6482901cf730717a10e5fa5a0d14a7443/server.js), [client](https://github.com/meirz911/qorgau-ai/blob/65d1ffb6482901cf730717a10e5fa5a0d14a7443/public/client.html), [dashboard](https://github.com/meirz911/qorgau-ai/blob/65d1ffb6482901cf730717a10e5fa5a0d14a7443/public/dashboard.html).

### Интерпретация

Наиболее полезны для Saq Bol не дополнительные названия AI-модулей, а короткое объяснение политики решения, разделение источников сигнала и работа с ошибками. Немедленное онлайн-обучение на одном клике аналитика добавляет риск от ошибочной разметки; для пилота предпочтительнее проверяемая очередь разметки и отдельный цикл обучения/валидации. Это инженерный вывод, а не обнаруженная эксплуатация чужого проекта.

### Пробелы

Не проверены развернутые демо, доступность публичных сервисов, прохождение чужих тестов, заявленная задержка, точность на реальных клиентах, права на бренд или соответствие банковским требованиям. Наличие README/скриншота/папки tests не закрывает эти вопросы. Источники приведены как основания сравнения, код и оформление не копировались.

## Вопрос 2. Какие из четырех дополнительных проектов относятся к другому сценарию?

### Вывод

Все четыре полезны как смежные антискам-решения; подтверждений, что они реализуют именно банковский pre-transfer BCC-кейс, в прочитанных файлах нет. Не включать их автоматически в число прямых конкурентов Saq Bol.

### Подтвержденные находки

- **h1keru2nem-sudo/MyProject / Qalqan AI**: `c77703c2f69df5e58d3c3e09e98ed57fa4f988a4`, 16.11.2026 14:41 UTC. Telegram-ассистент с RU/KZ, семейными связями SQLite, OCR и внешним Groq. README описывает голос/видео, RAM-контекст и семейные тревоги; в `bot.py` подтверждены Telegram, семейная БД и клиент Groq. Это защита до банковской операции через консультацию, не SOC-платежный шлюз. Слово privacy-first не означает, что весь анализ локальный. [README](https://github.com/h1keru2nem-sudo/MyProject/blob/c77703c2f69df5e58d3c3e09e98ed57fa4f988a4/README.md), [bot.py](https://github.com/h1keru2nem-sudo/MyProject/blob/c77703c2f69df5e58d3c3e09e98ed57fa4f988a4/bot.py), [коммит](https://github.com/h1keru2nem-sudo/MyProject/commit/c77703c2f69df5e58d3c3e09e98ed57fa4f988a4).
- **sasiska666/AAM_guard** занимается вербовкой через вакансии. В коммите от 6 ноября 2026 года `VacancyModel` объединяет TF-IDF по словам и символам с калиброванной логистической регрессией. Модуль OCR использует Tesseract. Есть проверки обычных и опасных вакансий и отдельные наборы оценки. Качество модели в этом исследовании не измерялось. [Классификатор](https://github.com/sasiska666/AAM_guard/blob/a3d7ed72d4129649eec25fca3c03e47af2c304d0/aam-guard/engine/ml.py), [OCR](https://github.com/sasiska666/AAM_guard/blob/a3d7ed72d4129649eec25fca3c03e47af2c304d0/aam-guard/engine/ocr.py), [тесты](https://github.com/sasiska666/AAM_guard/blob/a3d7ed72d4129649eec25fca3c03e47af2c304d0/aam-guard/tests/test_engine_bot.py), [оценка](https://github.com/sasiska666/AAM_guard/blob/a3d7ed72d4129649eec25fca3c03e47af2c304d0/aam-guard/tools/evaluate.py).
- **oralkanbekzan/Qorgau-Ai**: `dc9f6529a053a596c56abdcc4b47b0f2dd530461`, 16.11.2026 13:27:04 UTC. Статический браузерный сканер сообщений/ссылок/номеров и OCR с обучением моделей на клиенте. В `ml.js` есть Naive Bayes, logistic regression, softmax и MLP-функции. «Модератор» реализован проверкой PIN в клиентском JS и localStorage; это переключатель локального демо, не защищенная серверная роль. Полезна идея исправить OCR-текст перед повторной оценкой. [README](https://github.com/oralkanbekzan/Qorgau-Ai/blob/dc9f6529a053a596c56abdcc4b47b0f2dd530461/README.md), [ml.js](https://github.com/oralkanbekzan/Qorgau-Ai/blob/dc9f6529a053a596c56abdcc4b47b0f2dd530461/ml.js), [runtime](https://github.com/oralkanbekzan/Qorgau-Ai/blob/dc9f6529a053a596c56abdcc4b47b0f2dd530461/static-runtime.js), [коммит](https://github.com/oralkanbekzan/Qorgau-Ai/commit/dc9f6529a053a596c56abdcc4b47b0f2dd530461).
- **knrbvaademi/scam-radar-kz**: `deb437a42e935c939c94c2debb200a1564b325c2`, 18.10.2026 21:02:42 UTC. Telegram-бот и Flask-дашборд раннего обнаружения мошенничества среди молодежи. Есть категоризация сообщений, `analyze_risk`, сохранение сообщений и агрегаты dashboard; при отсутствии отчетов UI подставляет демонстрационные примеры. Не следует принимать эти карточки за реальные детекции. Банковское удержание/граф платежей не установлены. [README](https://github.com/knrbvaademi/scam-radar-kz/blob/deb437a42e935c939c94c2debb200a1564b325c2/README.md), [flask_app.py](https://github.com/knrbvaademi/scam-radar-kz/blob/deb437a42e935c939c94c2debb200a1564b325c2/flask_app.py), [коммит](https://github.com/knrbvaademi/scam-radar-kz/commit/deb437a42e935c939c94c2debb200a1564b325c2).

### Интерпретация

Для следующего этапа полезен самостоятельный «проверить сообщение» сценарий вне критического пути перевода, с согласованным хранением, явным источником анализа и редактированием OCR. Сейчас внедрение нового внешнего LLM/бота ради количества функций не улучшит надежность уже готового платежного сценария.

### Пробелы

Для четырёх дополнительных проектов SHA и даты сверены по конкретным коммитам. При повторной сверке GitHub вернул полные деревья всех четырёх. Выводы о функциях относятся к прочитанным файлам на этих версиях. Работу развёрнутых приложений и показатели авторов не проверяли.

## Вопрос 3. Что улучшить в Saq Bol практически сейчас?

### Вывод

Приоритет — сделать существующее решение банка понятным с первого экрана, сохранив разделение синтетического демо и реальной интеграционной границы. Не добавлять еще один процент, «магический AI» или вторую систему решений в браузере.

### Подтвержденные находки

- Локальный Saq Bol уже принимает отдельные структурированные причины с `code`, `layer`, `score_delta`, билингвальными текстами и ML-метаданными. Значит, компактное объяснение можно построить без нового API и без повторного скоринга. [contracts.ts](../../frontend/src/lib/contracts.ts).
- SOC inspector уже содержит статус, gauge, recipient flag controls, ML badge, причины, контекст, timeline и экспорт. Добавление еще одной длинной панели ухудшит сканирование; достаточно компактной структуры с раскрываемой подробностью. [case-inspector.tsx](../../frontend/src/components/case-inspector.tsx).
- В локальном risk engine есть оговорки для неподтвержденного fan-in, отдельно ограничение отмеченного получателя, silent duress и новый серверный guard повторной попытки во время удержания. Объяснение должно различать эти случаи, а не называть каждую блокировку доказанным дропом. [antifraud.py](../../backend/app/services/antifraud.py).

### Интерпретация

1. **Сейчас:** компактный RU/KK-блок «Основание решения / Шешім негізі»: контекст клиента, сеть/ограничения, ML-помощь. Он показывает только реальные response reason codes, не выводит новый вердикт. Сохранить конкретные серверные тексты в раскрываемой детали; неизвестные коды назвать дополнительными/неполными данными, не игнорировать.
2. **Сейчас:** явная разница между поведенческой паузой, тихой тревогой клиента, ответами анкеты и отметкой получателя. Низкий ML score не должен визуально «отменять» банковский запрет; сама тревожная биометрия не является доказательством виновности получателя.
3. **Пилот:** очередь подтвержденной разметки аналитиков, версии датасета/модели, отдельная проверка FPR по обычным переводам и новый holdout перед выпуском модели. Не дообучать production-модель немедленно одним кликом и не показывать синтетический recall как результат банка.
4. **Позже:** доступная функция помощи после мошенничества и анализ подозрительного сообщения вне transfer critical path. Использовать редактор текста/маскирование, официальный канал обращения и явно названные пределы проверки. Не имитировать подлинную криптографическую банковскую квитанцию или NBK-совместимость без контракта.

### Пробелы

Это сравнение локального кода, а не завершенная сертификация Saq Bol. Последние полные тесты, задержка, production build и browser QA проверяются отдельно в интеграционном прогоне. Человеческий IAM банка, реальные SDK-сигналы ОС и качество на банковских данных остаются самостоятельными задачами пилота.

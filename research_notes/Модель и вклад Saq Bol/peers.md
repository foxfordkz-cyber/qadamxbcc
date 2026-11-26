# Вечерние изменения у известных соперников

## Что изменилось после дневного обзора 25 ноября

### Takeaway

С 16:15 до 19:03 по времени Казахстана в публичных ветках двух знакомых проектов появились коммиты. Из них Axis/Qalqan обновил эксперимент с ИИ-консультантом, а Fraud Twin — оформление проекта. Оба существовали до вечернего среза. [Изменения Axis](https://github.com/Sofia5050/ITU_PROJECT/compare/865b679eda43a2425b21b0d2d73b3734a22ef4ef...217e3c8b436f32b6be06cd96c1d57cfe114aa458) · [Изменения Fraud Twin](https://github.com/shadix23/fraud-twin/compare/24605206623a216188f4ff6c85f3c5d8eac08792...cd782ff601295a0bc0f53fb886b51210690a2766)

### Cited Findings

- **16:45, Axis/Qalqan от Sofia5050.** Авторы показали клиента, которому ИИ-консультант по сбережениям рекомендует поддельный депозит «Моя цель+». Изоляция посторонних комментариев и проверка разрешённых банковских продуктов существовали до этого коммита. Обновлены сценарий, интерфейс и журнал эксперимента. На двадцати повторах одного синтетического сценария деньги в симуляции ушли 20 раз при выключенной защите и 0 раз при включённой. Для сохранённых ответов тест использовал groq:openai/gpt-oss-20b. Обычные комментарии проверялись отдельно. [Коммит](https://github.com/Sofia5050/ITU_PROJECT/commit/217e3c8b436f32b6be06cd96c1d57cfe114aa458) · [Результаты](https://github.com/Sofia5050/ITU_PROJECT/blob/217e3c8b436f32b6be06cd96c1d57cfe114aa458/results/attack_summary.md#L3) · [Серверная проверка](https://github.com/Sofia5050/ITU_PROJECT/blob/217e3c8b436f32b6be06cd96c1d57cfe114aa458/app/shield.py#L115)
- **18:02–18:06, Fraud Twin.** Три коммита после дневного снимка затронули README, схему архитектуры и изображения в docs/screens. Файлы программы, модель и численные результаты в этом сравнении совпадают. [Все изменённые файлы](https://github.com/shadix23/fraud-twin/compare/24605206623a216188f4ff6c85f3c5d8eac08792...cd782ff601295a0bc0f53fb886b51210690a2766)
- У NEXORA проверены 25 веток, включая граф и клиентскую защиту. Последний push репозитория был в 10:13 по времени Казахстана, до предыдущего обзора. У SafeSign, Sabyr, Qaqpan (adiletpn), Сенім Shield, Clean Break и «Тихого кода» тоже не обнаружены новые коммиты в проверенном интервале. [NEXORA](https://api.github.com/repos/SaginbekDaniel/SYNAPTIC-LABS/branches?per_page=100) · [SafeSign](https://api.github.com/repos/KItsunexdd/sudo-love-me-TIU) · [Sabyr](https://api.github.com/repos/theoneeyedking/sabyr) · [Qaqpan](https://api.github.com/repos/adiletpn/Qaqpan) · [Сенім](https://api.github.com/repos/adilusen/senim-shield) · [Clean Break](https://api.github.com/repos/ERA216/ITU-Hackathon) · [«Тихий код»](https://api.github.com/repos/narutouciha431-sketch/tihiy-kod)

### Inferences

- На защите Axis теперь может показать результат на конкретной клиентской операции. Эти 20 повторов измеряют поведение одного консультанта в одном заданном сюжете. Они не позволяют ранжировать антифрод-системы по точности на переводах населения. [Методика команды](https://github.com/Sofia5050/ITU_PROJECT/blob/217e3c8b436f32b6be06cd96c1d57cfe114aa458/results/attack_summary.md#L10)

### Gaps

- Учитывались публичные GitHub-репозитории. Установка приложений и повторение чужих опытов в эту проверку не входили. Время клиента, когда код был впервые опубликован, не всегда совпадает с датой коммита. [Документация GitHub](https://docs.github.com/en/graphql/reference/objects#commit)

## Какими моделями пользуются уже известные команды

### Takeaway

Настоящее обучение есть у нескольких соперников. Fraud Twin использует гистограммный градиентный бустинг, Сенім Shield экспортирует градиентный бустинг в клиентский JavaScript. Saq Bol обучает случайный лес, применяет его вместе с правилами, графом и поведенческими сигналами. Общей контрольной выборки у этих команд не опубликовано. [Fraud Twin](https://github.com/shadix23/fraud-twin/blob/cd782ff601295a0bc0f53fb886b51210690a2766/model/train.py#L51) · [Сенім](https://github.com/adilusen/senim-shield/blob/956c3c5b55ee610d9b132b086f73a926bf595a45/train.py#L120) · [Saq Bol](https://github.com/foxfordkz-cyber/qadamxbcc/blob/ff399275b0bcd2944bcb78f4807fcc8f5b3b07cb/backend/app/ml/model.py)

### Cited Findings

- Fraud Twin обучает sklearn HistGradientBoostingClassifier и хранит деревья в JSON. Банковский симулятор при включённом режиме модели применяет скорер к текущим признакам счёта и сверяет результат с порогом. Это действительно меняет действия симуляции. Авторская доля выведенных денег на пяти удерживаемых по очереди семействах схем составляет в среднем 44,5% для правил и 2,2% для модели. Процент выведенных денег отличается от доли остановленных операций. [Обучение](https://github.com/shadix23/fraud-twin/blob/cd782ff601295a0bc0f53fb886b51210690a2766/model/train.py#L51) · [Скорер](https://github.com/shadix23/fraud-twin/blob/cd782ff601295a0bc0f53fb886b51210690a2766/sim/fraudtwin/model.py#L84) · [Использование](https://github.com/shadix23/fraud-twin/blob/cd782ff601295a0bc0f53fb886b51210690a2766/sim/fraudtwin/engine.py#L244) · [Численные результаты](https://github.com/shadix23/fraud-twin/blob/cd782ff601295a0bc0f53fb886b51210690a2766/model/benchmark.json)
- Сенім Shield обучает GradientBoostingClassifier на синтетических данных, тест занимает 30% случайного стратифицированного разбиения. Полная модель содержит 140 деревьев. Сценарий клиента вызывает браузерный предиктор, читающий экспортированные параметры. [Разбиение и обучение](https://github.com/adilusen/senim-shield/blob/956c3c5b55ee610d9b132b086f73a926bf595a45/train.py#L92) · [Экспорт](https://github.com/adilusen/senim-shield/blob/956c3c5b55ee610d9b132b086f73a926bf595a45/train.py#L138) · [Вычисление](https://github.com/adilusen/senim-shield/blob/956c3c5b55ee610d9b132b086f73a926bf595a45/core.js#L47) · [Форма клиента](https://github.com/adilusen/senim-shield/blob/956c3c5b55ee610d9b132b086f73a926bf595a45/client.js#L320)
- Qorgan Antifraud от ZhanLI (alinaraevali18) обучает HistGradientBoostingClassifier, выдаёт predict_proba, выбирает пороги вмешательства с заданными пределами ложных тревог. Проверяемые исходники дают третью независимую реализацию ML. [Модель](https://github.com/alinaraevali18/qorgan-antifraud/blob/019c7a2d4736c97b6b0fff42394815e5773522fe/qorgan/model.py#L35) · [Сценарные тесты](https://github.com/alinaraevali18/qorgan-antifraud/blob/019c7a2d4736c97b6b0fff42394815e5773522fe/tests/test_pipeline.py#L29)

### Inferences

- Для жюри преимущество лучше обосновывать воспроизводимым измерением честных пауз и пропущенных денег на одной и той же контрольной выборке. Разница между «случайным лесом» и «бустингом» сама по себе не показывает, чья система точнее. [Saq Bol](https://github.com/foxfordkz-cyber/qadamxbcc/blob/ff399275b0bcd2944bcb78f4807fcc8f5b3b07cb/docs/MODEL_EVALUATION.md) · [Fraud Twin](https://github.com/shadix23/fraud-twin/blob/cd782ff601295a0bc0f53fb886b51210690a2766/model/benchmark.json)

### Gaps

- Условия авторских экспериментов и статистические единицы различаются. В данном обзоре не подтверждены общие независимые испытания или качество любого из этих решений на денежных переводах клиентов БЦК. [Методика Saq Bol](https://github.com/foxfordkz-cyber/qadamxbcc/blob/ff399275b0bcd2944bcb78f4807fcc8f5b3b07cb/docs/MODEL_EVALUATION.md) · [Методика Fraud Twin](https://github.com/shadix23/fraud-twin/blob/cd782ff601295a0bc0f53fb886b51210690a2766/model/train.py)

## Что проверялось и какие старые сведения изменились

### Takeaway

В основном проходе запрошены 55 прежних адресов, включая смежные проекты, витрины и тёзок. Публичный доступ подтвердился для 54 адресов со 100 ветками. Дополнительно спустя несколько минут подтверждены ранее упомянутые SafeRoute и ObsidianBank, по одной ветке у каждого, оба обновлялись в последний раз 20 ноября. Итого 57 адресов, 56 доступных и 102 ветки, в них два знакомых проекта с новыми коммитами. Это число проверенных репозиториев, число зарегистрированных команд из него не следует. [Дневная база](../../reports/Команды%20BCC%20к%2025%20ноября.md) · [SafeRoute](https://github.com/kumarovdee/saferoute-pilot/commit/c65b933c07d8f6071a3e5fa3414b6ec5da25bf9b) · [ObsidianBank](https://github.com/Dikooshaa/ObsidianBank/commit/e4c82b9f0964a7f7be588294aebe3072e053c7d3)

### Cited Findings

- Дневные списки сопоставлены с GitHub GraphQL Repository, refs/heads, HEAD каждой ветки и её history(since: 2026‑11‑25T11:15:00Z), временем pushedAt всего репозитория и последними публичными релизами. Для двух изменившихся проектов точные дневные SHA сравнены с текущими. Новых опубликованных GitHub Releases среди проверенных адресов в этом интервале не было. По meirz911/qorgau-ai GitHub вернул NOT_FOUND. [История Fraud Twin](https://github.com/shadix23/fraud-twin/compare/24605206623a216188f4ff6c85f3c5d8eac08792...cd782ff601295a0bc0f53fb886b51210690a2766) · [История Axis](https://github.com/Sofia5050/ITU_PROJECT/compare/865b679eda43a2425b21b0d2d73b3734a22ef4ef...217e3c8b436f32b6be06cd96c1d57cfe114aa458) · [Недоступный адрес](https://api.github.com/repos/meirz911/qorgau-ai)
- **Banu190/Fraud Replay.** Ветка master содержит каркас. В рабочей ветке есть CLI анализа синтетического CSV, поиск цепочек через NetworkX, правила риска и тесты. Просмотрен текст в шести ветках, включая README и конфиги. В этих файлах прямой привязки к банку обнаружить не удалось. Последнее опубликованное обновление 24 ноября в 23:39 по времени Казахстана. Это исправление старого статуса «пустой», которое не увеличивает число сегодняшних находок. [Дерево master](https://github.com/Banu190/-ITU-hackathon/tree/5177f05401e9f0e8519c8aa76f4be9c0ea02d06b) · [Модуль анализа](https://github.com/Banu190/-ITU-hackathon/blob/a15d13d071b5c8eabd24efbed81457ed36a889b3/fraud-replay/backend/fraud_engine/README.md#L18) · [Код](https://github.com/Banu190/-ITU-hackathon/blob/a15d13d071b5c8eabd24efbed81457ed36a889b3/fraud-replay/backend/fraud_engine/detector.py#L21) · [Метаданные](https://api.github.com/repos/Banu190/-ITU-hackathon)
- Артефакт ObsidianBank действительно представляет собой один ZIP в основном дереве. SafeRoute — отдельный проект kumarovdee. София ведёт свой Axis/Qalqan, а sainoshii/qalqan — самостоятельный репозиторий с другим автором и назначением. [ObsidianBank](https://github.com/Dikooshaa/ObsidianBank/tree/e4c82b9f0964a7f7be588294aebe3072e053c7d3) · [SafeRoute](https://github.com/kumarovdee/saferoute-pilot/tree/c65b933c07d8f6071a3e5fa3414b6ec5da25bf9b) · [Qalqan от sainoshii](https://github.com/sainoshii/qalqan/blob/03c44a1e355ef4e972c918234ab333073b74c835/README.md)

### Inferences

- Две вечерние активности у известных проектов и обнаружение новых репозиториев — две разные величины. Поиск новых первичных кандидатов ведётся отдельно. [Дневная база](../../reports/Команды%20BCC%20к%2025%20ноября.md)

### Gaps

- Теги без релиза, удалённые ветки, локальные наработки, приватные репозитории и обновления внешних демосайтов этим методом не покрыты. Официальные регистрации команд отдельно не установлены. [Что представляет refs](https://docs.github.com/en/graphql/reference/objects#ref)

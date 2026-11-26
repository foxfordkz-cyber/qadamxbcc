# Новые публичные работы по кейсу БЦК

## Что появилось после дневной проверки 25 ноября

### Takeaway

Нашлась одна новая публичная работа, автор которой прямо называет кейс БЦК на ITU Hackathon 2026, — **Both Sides**. В 16:15 по Казахстану этого репозитория ещё не существовало. GitHub зарегистрировал его создание 25 ноября в 18:29:45, а последний проверенный push — в 18:53:09. Время UTC+5. Владелец — murzakhmetov. [Метаданные GitHub](https://api.github.com/repos/murzakhmetov/both-sides) · [Привязка к конкурсу в README](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/README.md#L7)

### Cited Findings

- Дневной запрос с точным названием соревнования давал 25 результатов. При повторе тот же набор полей и дат с фильтром открытой видимости дал 26. Один новый относительно прежних заметок — Both Sides. Репозиторий не является форком. Коммит основной ветки восстановлен на момент перепроверки — `79b70dd12884b3c0b2ea62b06eb83cad976fcb84`, 25 ноября, 18:53:05. Момент создания проекта самим автором из этих дат установить нельзя. [Дневной поиск](../Команды%20BCC%20к%2025%20ноября/discovery.md) · [Поисковая выборка GitHub](https://github.com/search?q=%22ITU+Hackathon+2026%22+in%3Aname%2Cdescription%2Creadme+created%3A2026-11-01..2026-11-25+fork%3Atrue+is%3Apublic&type=repositories) · [Коммит](https://github.com/murzakhmetov/both-sides/commit/79b70dd12884b3c0b2ea62b06eb83cad976fcb84)
- У Both Sides вопрос возникает, когда банк уже остановил внутренний перевод. Отправитель и получатель видят отдельные экраны и самостоятельно отвечают, с кем и за что рассчитываются. Тест ввода и отображения проверяет, что контрагенту не видны ни чужой ответ, ни оценка. Счета и клиенты учебные. [Экраны и границы демонстрации](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/README.md#L55-L65) · [Тест приватности](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/tests/test_privacy.py#L70) · [Учебные данные](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/README.md#L182)

### Inferences

- Критерий включения — публичный код и явное указание соревнования и кейса самими авторами. Наблюдение подтверждает ещё один проект сопоставимого направления. Состав команды и приём организатором заявки из GitHub установить нельзя. [README проекта](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/README.md#L7) · [Порядок приёма заявок](https://beta.egov.kz/org/zhambyl-talas/press/news/details/1328207?lang=kk)

### Gaps

- Публичного перечня команд, допущенных на банковский кейс, в проверенных источниках найти не удалось. В объявлении акимата приём заявок указан с 6 по 20 ноября, отбор — с 21 по 26 ноября, далее выберут 15 финалистов. Репозиторий могли создать уже после подачи заявки. [Акимат Таласского района](https://beta.egov.kz/org/zhambyl-talas/press/news/details/1328207?lang=kk)

## Как устроена их проверка и какой результат опубликован

### Takeaway

У Both Sides есть подключаемый внешний Gemini и автономное сопоставление двух текстов. На публичной странице с коротким примером работает автономный вариант. Отчёт с метриками относится к 99 смоделированным парам текстов, спокойным остальным признакам банка и отсутствию повторяющейся истории. [Фабрика модулей сравнения](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/bothsides/matching/factory.py) · [Мини-демо](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/bothsides/cases/tryout.py) · [Исходный отчёт](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/evaluation/results/offline.json)

### Cited Findings

- Локально сравниваются словарные признаки на казахском, русском и английском, сочетания символов и сходство строк. Вероятность получается из логистической формулы с заданными весами. При недоступности внешнего обработчика есть резервный вариант. Одного низкого результата автономного сравнения достаточно для передачи человеку. Автоматическое удержание по явному противоречию в ответах доступно при сравнении Gemini. [Локальный модуль](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/bothsides/matching/offline.py) · [Резервный путь](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/bothsides/matching/chain.py) · [Правила решения](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/bothsides/decision/gate.py)
- На 40 честных парах автоматически разрешены 19, а 21 передана человеку. В группе с одной заученной историей автоматически разрешены 10 из 18. AUC по честным против остальных — 0,7504. По честным против сценария с подсказанной историей — 0,4319. В этих 99 эпизодах автономная логика ни разу сама не оставила платёж в статусе «удержан». Все суммы, пары и оценки происходят из симуляции авторов. [Числа по каждой группе и доверительные интервалы](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/evaluation/results/offline.json) · [Описание набора](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/README.md#L156-L176)

### Inferences

- Это ориентир для повторной проверки остановленного перевода двумя независимыми рассказами. Для Saq Bol проверяемый эксперимент — выяснить, сколько честных переводов удастся отпустить быстрее и сколько согласованных легенд пройдёт. Сравнение AUC по текстам с долей срабатываний Saq Bol по всем операциям не выявляет более точную модель. [Определение задачи Both Sides](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/README.md) · [Сценарии Saq Bol](https://github.com/foxfordkz-cyber/qadamxbcc/blob/ff399275b0bcd2944bcb78f4807fcc8f5b3b07cb/docs/SCENARIO_STAND.md)

### Gaps

- Публичного прогона Gemini на всех 99 парах или разметки настоящих клиентов авторы не приводят в файле результатов автономного модуля. В README банк и push-уведомления моделируются, работа ограничена двумя клиентами одного банка. [Ограничения](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/README.md#L182-L197)

## Как проверялись результаты поиска и совпадения

### Takeaway

Для обнаружения проведены 36 запросов к GitHub Repository Search API, затем девять запросов для перепроверки и разрешения совпадений. В совокупности эти 45 выдач дали 419 уникальных имён репозиториев в первых страницах результатов. Ещё пять узких поисков уточнили идентичность ранее упомянутого SafeRoute. Это число поисковых результатов, а количество подтверждённых новых прямых проектов по-прежнему равно одному. [Поиск названия конкурса в созданных после 16:15](https://github.com/search?q=%22ITU+Hackathon%22+in%3Aname%2Cdescription%2Creadme+created%3A%3E%3D2026-11-25T11%3A15%3A00Z+fork%3Atrue+is%3Apublic&type=repositories) · [Поиск обновлённых работ по банку](https://github.com/search?q=%D0%A6%D0%B5%D0%BD%D1%82%D1%80%D0%9A%D1%80%D0%B5%D0%B4%D0%B8%D1%82+in%3Aname%2Cdescription%2Creadme+pushed%3A%3E%3D2026-11-25T11%3A15%3A00Z+fork%3Atrue+is%3Apublic&type=repositories)

### Cited Findings

- Интервал после дневного среза задан как `created:>=2026-11-25T11:15:00Z` или `pushed:>=2026-11-25T11:15:00Z`. Дополнительные запросы охватили с октября по 25 ноября, названия ITU/Taraz/Тараз, BCC/БЦК/ЦентрКредит/CenterCredit, казахские, русские и английские слова про мошенничество, а также формулировку темы организатора. Все поиски использовали `fork:true` и `is:public`. Сначала сравнивались кандидаты с предыдущими заметками и присланным списком, затем открывались README, дерево и конкретные файлы для правдоподобных совпадений. [Ранний список](../Команды%20BCC%20к%2025%20ноября/discovery.md) · [Фраза темы организаторов](https://github.com/search?q=%22%D0%98%D0%BD%D0%BD%D0%BE%D0%B2%D0%B0%D1%86%D0%B8%D0%B8+%D0%B2+%D0%B1%D0%B0%D0%BD%D0%BA%D0%B8%D0%BD%D0%B3%D0%B5%22+in%3Areadme+pushed%3A%3E%3D2026-11-25T11%3A15%3A00Z+is%3Apublic&type=repositories)
- **SafeRoute** из прежнего сообщения найден у kumarovdee по сочетанию темы антифрода и работы в теневом режиме. Создание и последний push — 20 ноября. Его README не называет ITU и БЦК. У Dikooshaa/ObsidianBank создание и последний push также датированы 20 ноября, в дереве один архив. Связь с конкретной заявкой по описанию и дереву не установлена. [SafeRoute](https://github.com/kumarovdee/saferoute-pilot/blob/c65b933c07d8f6071a3e5fa3414b6ec5da25bf9b/README.md) · [Даты SafeRoute](https://api.github.com/repos/kumarovdee/saferoute-pilot) · [ObsidianBank](https://github.com/Dikooshaa/ObsidianBank/tree/e4c82b9f0964a7f7be588294aebe3072e053c7d3) · [Даты ObsidianBank](https://api.github.com/repos/Dikooshaa/ObsidianBank)
- Вечерняя публикация **mirranet/BCC-Hackhathon** разрабатывает ИИ-ревьюера технических требований. В этот же день стартовал отдельный BCC-HUB × MNU с таким заданием. Другой результат поиска, finance-app, разбирает выписки Kaspi для личного учёта. Оба исключены из числа прямых антифрод-соперников. [ReqSentinel](https://github.com/mirranet/BCC-Hackhathon/blob/5d8d79345b3529c8bb7ce07384e2bec94dfc8f85/README.md) · [Официальная страница MNU](https://bcchubagents.mnu.kz/kk.html) · [Личные финансы](https://github.com/Alinur808/finance-app/blob/c71d93e2d5e83ed5fc3b9b67f1d10538a66e0c2e/README.md)

### Inferences

- Если репозиторий был создан раньше, но сегодня появились новые коммиты, это обновление известного проекта. Если есть исходники без связи с ITU и кейсом БЦК, запись оставлялась кандидатом. [Хронология GitHub](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories) · [Самопривязка Both Sides](https://github.com/murzakhmetov/both-sides/blob/79b70dd12884b3c0b2ea62b06eb83cad976fcb84/README.md#L7)

### Gaps

- Использовалось до 100 результатов на запрос. В трёх широких выдачах среди 45 проверенных найдено больше ста. Закрытые репозитории, недавно открытые проекты без индексированных ключевых слов, материалы на других платформах и неизвестные названия не входят в эту выборку. Последний основной поиск завершён в 19:04:52 по Казахстану, 25 ноября 2026 года. [О поиске GitHub](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories)

# Saq Bol 2.9 build 24 — финальная техническая приёмка

> Исторический отчёт о публичном build 24 от 25 ноября. Приёмка отдельного
> постоянного staging и установленного на Honor build 26 от 26 ноября находится
> [здесь](FINAL_LIVE_INTEGRATION_ACCEPTANCE_RU.md). Публичный build 24 не заменён.

Дата: 25 ноября 2026, UTC+5. Рабочая ветка: `integration/final-build24`.
Состояние ниже относится к этой проверке, а не к прежним 335 тестам.

## Результат и границы

Собрана единая ветка от `main` `3e62b73c67c813f5dda5ee165351dabf66514399`.
Обычными merge объединены #35 (`4e15d432…`) и #36 (`22ea4038…`). Head #33
(`6b775311…`) уже является предком #35. На этом шаге конфликтов не возникло; #32/#34
повторно не копировались. Во время проверки команда продвинула main до
`ebb065fd85ea1313ec35fa383f3b41ba12184afe`. Он также объединён обычным merge:
единственный конфликт в `connected.mjs` разрешён с сохранением новых категорий
сообщений и условия `!socMode()` у старой панели расследования. Затронутые серверные
модули, browser suite и frontend повторно проверены на итоговом merge.
Авторство и дизайн Айданы сохранены. Мы не изменяли main.
На момент аудита #33/#35/#36 открыты, #35/#36 Draft, опубликованных review нет.

Главное новое отрицательное наблюдение: публичный сервер уже потерял проверяемую
прежнюю операцию. `28e43557-b7b6-4584-8397-e3e8104f9944` возвращает 404 клиенту,
SOC возвращает 0 совпадений. Журнал Render показывает остановку в 21:51:01 и новый
процесс в 21:57:34–21:57:47, deployment остался `d0538472…`. Инициатор SIGTERM
журналом не установлен; засыпание Free совместимо с наблюдением. В этой работе
Deploy/Restart, изменение env, хэшей и удаление публичных данных не выполнялись.
Прежний баланс и 12 текущих операций не являются доказательством сохранности:
seed мог восстановить те же начальные значения.

| Направление | Решение | Область |
|---|---|---|
| LOCAL DEMO | GO | Синтетический HTTP API, реальные локальные PostgreSQL/Redis, Fake Guardian |
| PUBLIC DEMO | NO-GO | Полный заявленный сценарий с сохранной историей пока не обеспечен; вход трёх ролей работает |
| LIVE TELEGRAM E2E | NO-GO | Только read-only Bot API; публичный backend fake, новых сообщений/согласия/двухтелефонной записи нет |
| PERSISTENT STORAGE | GO локально / NO-GO публично | Два API рестарта + полный restore проверены отдельно от Render |
| RELEASE DISTRIBUTION | GO для bytes / PARTIAL для main | Сайт, current/team и подписанный build 24 совпадают; main ждёт review |

## Матрица проблем и проверок

| Задача | Статус | Причина / исправление | Проверка и доказательство | Что осталось |
|---|---|---|---|---|
| Объединение #33/#35/#36 | PASS | Единая ветка, сохранение истории; поступивший main также включён | Один конфликт SOC UI разрешён с обеими функциями; regression и release verification | Merge техлидом |
| Публичное постоянное хранение | FAIL | TemporaryDirectory SQLite + Redis без AOF/RDB, новый процесс создаёт seed | Read-only API: старый UUID 404; Render runtime log | Получить полноценный backup либо отдельное решение о переносе |
| Выгрузка текущей полной БД | BLOCKED | Free не предоставляет Shell/Disk; в текущем коде нет полного export API | Dashboard и код `mobile_ephemeral.py`/`backup_mobile_sqlite.py` | Доступ провайдера/владельца без замены процесса; частичный JSON не backup |
| Локальный Docker Desktop | BLOCKED | Windows 1455 / давление виртуальной памяти, ранее API 500 | Диагностика WSL/context/памяти; чужие volumes не удалялись | Docker engine отдельно; не является блокером native PG проверки |
| Альтернатива Docker | PASS | PostgreSQL 16 + Redis 7 в Ubuntu WSL, отдельные случайные loopback-порты | `rehearse_release_storage --native` | Это не Docker E2E |
| Два API рестарта | PASS | Три роли, сохранение сессий, ledger, UUID и idempotent replay | `PASS restart 1/2` в storage log | Не переносить вывод на публичный Render |
| Guardian и SOC после рестартов | PASS | Синтетический consent, доставка Fake, ACK → suspicion → duplicate → ACK, ровно одно дело | Два рестарта проверяют audit, дело, ответ, баланс; новый worker не отправляет дубль | Live callback и второй телефон |
| Полное восстановление PostgreSQL | PASS | `pg_dump -Fc` → другая БД, все таблицы, canonical rows, schema/constraints/indexes/sequences | `full PostgreSQL restore` в storage log | Полная копия публичной SQLite отсутствует |
| Перенос SQLite → PostgreSQL | PASS | Существующий импорт, отдельная база `qadam_import_rehearsal`, сравнение типизированных строк | 5 storage-import тестов на реальной PostgreSQL | Это синтетическая копия |
| Защита существующих аккаунтов | PASS локально | Bootstrap пропускает непустую БД; persistent template выключает seed; добавлен platform hash | Full backend + два рестарта с прежними токенами/ролями | Сохранить env hashes и signing key при реальном переносе |
| Telegram-конфигурация | PASS read-only | DPAPI секрет использован только для getMe/getWebhookInfo | Бот совпал, private enrollment есть, webhook отсутствует, 0 сообщений, 0 consumed updates | Новое согласие и общий persistent backend для live |
| Live Android → Telegram → SOC → Android | NOT TESTED | Публичный режим fake; его изменение требует безопасного deployment | Новые сообщения не отправлялись | Сценарий в OWNER_ACTIONS_REQUIRED_RU.md |
| APK и сайт | PASS | Канонический `.demo` build 24 не пересобирался и не переименовывался в новый релиз | Скачать bytes, SHA, signer, package, 40 UI assets/source, current=team | Main manifest станет актуальным после review |
| Android build 25 candidate | PARTIAL | Входящий main меняет Android UI, поэтому новая сборка получила новый code | JDK 21 build PASS; прежняя подпись, origin, pinned source и новые вложенные assets совпали | Не установлен, не опубликован; физический upgrade/session test отложен пользователем |
| API compatibility | PARTIAL | Локальный endpoint/legacy 404/405 fallback проверяются; публичный endpoint ещё 404 | OpenAPI snapshot PASS, unit/browser contracts | Безопасно развернуть новый backend |
| Разделение ролей публично | PASS | Client и platform не получают SOC; SOC не получает staff management | 3 настоящих login; 403/403/403 и platform staff 200 | Новая физическая проверка отменена |
| CI GitHub | BLOCKED | Billing/spending-limit annotation в jobs | PR check audit; review отсутствуют | Владелец billing → повторный CI → review |
| Физический Honor | NOT TESTED заново | ADB сначала показал Honor X6, затем устройство исчезло; владелец отменил проверку | Исторические скриншоты отдельно в `evidence/ecosystem-24/` | Только по новой договорённости с владельцем |
| Видео двух телефонов | NOT TESTED | Не снято, второго подтверждённого контакта/устройства нет | Подробный сценарий подготовлен | Личное участие после снятия серверных блокеров |

## Локальные исправления

Добавлены безопасный Linux/WSL storage runner, реальные PostgreSQL Guardian-сценарии
и проверка аудита/одного SOC-дела в репетиции рестартов. Initdb получает временный
пароль через закрытый файл вместо недоступного WSL `/dev/stdin`; файл сразу удаляется.
Redis запускается без пустого Windows-аргумента. Завершение останавливает только
собственные службы. Таймаут acceptance HTTP увеличен до 30 секунд для загруженного
runner; это не изменение API и не заявление о производительности.

Добавлен отдельный staging blueprint для уже доступных PostgreSQL/Redis: без создания
платных ресурсов и без изменения текущего сервиса. Исправлены устаревшая ветка,
отсутствующий platform hash и автоматический bootstrap в cutover template. Ключ подписи
теперь запрашивается из существующего защищённого хранилища вместо генерации нового
при переносе. В панели
Supabase найден `qadam-demo`; внутренний экран проекта не загрузился. Доступ к отдельной
пустой целевой БД не подтверждён; командные таблицы не изменялись.

Обновлены браузерные проверки под сохранённый дизайн Айданы: семантические метрики,
rowheader времени и язык в профиле. Проверка входа учитывает существующий единственный
retry при явном 503 (5 секунд), запрещает retry неверного пароля и раннюю выдачу роли.
Никакой новой авторизации или ослабления проверок не добавлено. Опубликованный APK
не менялся. Новые UI-функции, пришедшие из main, входят в исходники для review;
они не приписываются выпущенному APK с pinned source `24e51149…`. Для изменившихся
исходников отдельно подготовлен кандидат build 25; он не заменяет публичный build 24
и требует отдельной Android-приёмки. Сведения о его сборке приводятся отдельно.

## Автоматические результаты

Полный исходный backend-прогон: **794 PASS, 34 SKIP**; PostgreSQL/Redis: **30 PASS**;
регрессия входящего main: **78 PASS, 2 SKIP**. PG-import: **5 PASS**, из них только
один ранее пропущенный тест дополнительно увеличивает итог. По полным test ID это
**829 уникальных backend PASS**, остаются шесть Windows-несовместимых Unix-проверок.
Frontend: **211 PASS** (207 + 4 проверки release guard), Android unit: **50 PASS**,
browser: **38 PASS, 7 SKIP**. Итого **1128 уникальных автоматических тестов**.
Для browser исходный прогон дал
36 PASS / 2 FAIL / 7 SKIP; два упавших теста повторены успешно на новом изолированном
preview-порту без изменения приложения (обрыв локального fetch и timeout).
Полные списки и метод подсчёта — `evidence/final24/verification.json` и
`backend-test-ids.json`; повторные прогоны одного теста не суммируются.
Локальные проверки не объявляются успешным удалённым CI или физическим E2E.

Полный backend-прогон относится к интеграционной базе `db49a00`; после входящих
изменений main выполняется дополнительный набор затронутых серверных тестов.
Объединение результатов дедуплицируется по полному test ID. Не следует называть
это повторным полным прогоном новой ревизии.

`ruff`, `ruff format`, `mypy`, TypeScript, OpenAPI, manifest/source/signature и Render
schema прошли. Next production build и Cloudflare build + workerd smoke прошли,
Compose config валиден. Docker image/Compose E2E не заменяется native Linux.
Проверки `verify.sh` выполнены отдельными командами с существующими зависимостями,
без повторного `npm ci` в общей рабочей среде. Итог каждой команды — в evidence.

## Релиз и воспроизведение

- [Страница APK и QR](https://saq-bol-bcc.zerdeliportald.workers.dev/download/android/).
- [Канонический APK](https://saq-bol-bcc.zerdeliportald.workers.dev/downloads/Saq-Bol-2.9-119355ceea55.apk).
- Version `2.9`, code `24`, package `kz.qadamx.bccshield.demo`, 10 754 120 bytes.
- SHA-256 `119355ceea55b6087c357006ae14b2f272a72de00538521948d68362ecdfebf1`.
- Signer `0dd732df01a3c1d98ec7b2ebfbd448b7d783080bfc784845676df8eb10aad0ab`.
- APK source `24e51149210c8fd4bc96815b457d2b7d55d7e537`, API `https://saq-bol-mobile.onrender.com`.
- Сайт `/soc` ведёт на mobile `/soc/`; jury room остаётся отдельным набором данных.
- Контракт: `docs/contracts/ECOSYSTEM_OPENAPI.json`.

Отдельный локальный кандидат: `Saq-Bol-2.9-25-candidate.apk`, 10 760 752 bytes,
SHA-256 `e74ccf2d1ec7a9f5a190db5b691e843a7a2a32abe24fa061ef3ae38803129b30`,
source `051a50df2e920f528e96896b0ee8c9fd51ec3310`. Подписан тем же сертификатом,
package/origin сохранены. `assembleShowcase` успешно выполнен под существующим
JDK 21 и Android SDK; первоначальные ошибки Java 25/SDK location исправлены
настройкой локальной сборки. На сайте остаётся build 24. Установка и сохранение
данных на физическом Android для кандидата **не проверены**, эмулятор не запускался.
Manifest кандидата: `evidence/final24/android25-candidate.json`.

При финальной сверке сайт оказался снова на build 22: Cloudflare deployment
`a3a6642e-f693-47fd-aba4-9e347f330b8f` от 17:31 UTC сменил ранее подтверждённый
build 24. Выполнено разрешённое обновление только статического Worker с сохранением
актуальных изменений main и действующих vars (`--keep-vars`). Новый Worker version:
`424880a4-f276-4395-8f92-f769319205be`. Render не перезапускался. Добавлен predeploy
guard от downgrade и несовпадения исходных/собранных assets. Результат повторного
скачивания после публикации — `evidence/final24/public-release-final.json`.

Из `backend` в изолированной среде с установленными зависимостями:

```text
python -m scripts.rehearse_release_storage --native
python -m scripts.check_native_storage
python -m scripts.export_ecosystem_contract --check
```

Без `--native` прежний rehearsal использует собственные Docker containers. Не указывать
публичный URL или командную БД в тестовые env. Полный порядок backup/cutover —
[PERSISTENCE_AND_RECOVERY_RU.md](PERSISTENCE_AND_RECOVERY_RU.md). Действия, которые
требуют владельца/второго телефона, — [OWNER_ACTIONS_REQUIRED_RU.md](OWNER_ACTIONS_REQUIRED_RU.md).

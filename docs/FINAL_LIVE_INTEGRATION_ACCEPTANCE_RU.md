# Публичный постоянный staging — приёмка 26 ноября 2026

**Staging работает: `/ready` = HTTP 200.** Выполнены два реальных рестарта API, полный PostgreSQL backup/restore и операция с физического Honor через веб-SOC обратно в Android. **Telegram проверен через Fake Adapter; live — BLOCKED.** Старый `saq-bol-mobile`, основной API и публичный APK build 24 не переключались.

## Развёртывание и причина Docker-сбоя

| Компонент | Фактическое состояние |
|---|---|
| Существующий сервис | `https://saq-bol-mobile-staging.onrender.com` — Oregon, Free, auto deploy выключен |
| Проверка готовности | `https://saq-bol-mobile-staging.onrender.com/ready` → `200 {"status":"ready"}` |
| Backend revision | `c3f77037ce15f191261cf456b891c74e2ce2672a` |
| Deployment | `dep-dc3q5qlg1s2s73cd4j30`, live 26 ноября около 08:13 UTC+5 |
| Docker | `backend/Dockerfile.persistent`, `sh scripts/start-persistent.sh staging-api` |
| PostgreSQL | Существующий `saq-bol-api-db`, отдельная база `saq_bol_staging` |
| Alembic | `0016_dispute_history` |
| Redis | Существующий Valkey 8.1.10; только DB 12 |
| Worker | Hosted worker включён, SQL outbox, Telegram mode `fake` |
| Веб-кабинеты | `https://saq-bol-mobile-staging.onrender.com/wallet/` |

При первой фактической настройке значения, перенесённые через защищённые браузерные поля, оказались буквальными `<redacted>`. Включая некорректное значение build argument вместо `false`. Конфигурация исправлена штатным импортом закрытого локального env-файла в Render; временный файл удалён после сохранения.

В успешном **реальном build log** выполнена ветка `case "false"`, упаковка Android installer пропущена, образ собран. Передача `QADAM_INCLUDE_ANDROID_RELEASE=false` в Docker builder подтверждена логом, а не предположением по runtime YAML. Default ARG `true` и обычная release-упаковка сохранены. Публичный установщик staging не выдаёт.

## Постоянное хранилище

- Отдельные `saq_bol_staging` и `saq_bol_staging_restore` принадлежат `saq_bol_staging_owner`: LOGIN, без SUPERUSER/CREATEDB/CREATEROLE. PUBLIC-доступ к новым базам отозван. SELECT grants на основные таблицы `bcc_shield` у этого пользователя не обнаружены; основная база не изменялась.
- Внешние SQL-проверки и backup: TLS 1.3, `verify-full`, сертификат проверен. Внутренний Render URI требует TLS; startup проверяет `pg_stat_ssl` своего соединения.
- `prepare_staging.py` отвергает другое имя базы, SQL-пользователя, Redis DB и неподходящий режим. Первое заполнение требует явного разрешения bootstrap и пустой DB 12. После seed выставлено **`BCC_BOOTSTRAP_DEMO=false`**. При обоих рестартах журнал подтвердил сохранение существующих данных.
- Пароли демоаккаунтов и signing key стабильны. Защищённые локальные материалы — Windows DPAPI + персональный ACL, вне Git. Новые пароли при рестарте не генерируются.
- Временное разрешённое правило IP `/32` **удалено после backup и Fake callback-проверок**. В панели сохранено блокирование внешнего Internet-доступа к PostgreSQL. Внутренний staging после этого продолжает отвечать `/ready=200`.
- Valkey Free: 25 MB, 50 connections, persistence off. Рестарт самого Valkey может потребовать повторного входа; ниже проверялись рестарты API. Финансовые операции, кейсы и outbox хранятся в PostgreSQL.
- Текущий Free PostgreSQL истекает **20 декабря 2026** по панели Render. Возможны cold start бесплатного web service. Это ограниченный учебный стенд, не production SLA.
- Supabase `Shezhire/qadam-demo` принадлежит другому проекту и не использован.

## Два реальных рестарта staging API

До рестартов через HTTPS созданы approved 25 000 ₸, cooling_off 900 000 ₸ и blocked 250 000 ₸. Баланс изменился только на 25 000 ₸: 4 571 500 → **4 546 500 ₸**. Повтор approved-запроса вернул тот же UUID без второго списания.

| Рестарт | Проверка после запуска (UTC+5) | Результат |
|---|---|---|
| 1 | 26 ноября 08:22:37; instance `7m2gv` → `2ln4v` | UUID, баланс, история, кейс, callback audit и сессии сохранены |
| 2 | 26 ноября 08:29:54; instance `2ln4v` → `nr2sw` | Те же данные сохранены, повторного списания нет |

Использован Render **Restart service только staging**. Доказательство: [acceptance.json](evidence/live-staging/acceptance.json). `transactions.*.status` там фиксирует первоначальное решение evaluate; cooling_off затем отменён клиентом после ответа SOC.

## Полное восстановление базы

После обоих рестартов `pg_dump` 18.7 создал полный custom-format dump, `pg_restore` восстановил его в отдельную `saq_bol_staging_restore`. Основная база не была целью restore; `--clean` не применялся.

Сверены **25 таблиц, 8 295 строк, 198 колонок, 246 constraints, 70 индексов, 0 sequences**: значения каждой строки, колонки, ограничения, индексы и последовательности. При первом текстовом сравнении CHECK PostgreSQL изменил форму cast массива; выражения нормализованы его SQL-парсером, эквивалентность подтверждена. Это полный dump, не CSV.

- 548 786 bytes; SHA-256 `ef47de163abcd297164b0286e997074a272484f6d3725bd899b948d277e1694e`.
- Защищённая копия вне контейнера/Git: `%LOCALAPPDATA%\QadamShield\Staging\saq_bol_staging-full.dump`.
- [backup-restore.json](evidence/live-staging/backup-restore.json). Restore-база сохранена.
- Снимок сделан **до последующей операции с Honor**; эта более поздняя операция не заявляется частью данного dump.

## Honor → PostgreSQL/Fake Guardian → веб-SOC → Honor

На физическом **Honor X6 / VNE-LX1** установлен build **26** поверх build 24 без удаления приложения/данных. Сохранены package ID и сертификат. Использован обычный интернет телефона; `adb reverse` пуст, локальный API-прокси не использовался.

1. Клиент вошёл в Android через настоящий серверный login.
2. Через UI телефона создан перевод **900 000 ₸** Алексею К. с контекстом звонка. Сервер вернул `cooling_off`.
3. Transaction ID **`fbe36620-a926-498b-b2a1-7dc2a776fdf4`** появился в веб-SOC без перезагрузки страницы.
4. Hosted Fake worker обработал SQL-очередь. Контролируемые ACK/suspicion переданы существующему сервису: по одному событию ACK и suspicion, повтор не создал второй кейс.
5. Hosted monitor создал ровно один кейс **`051bd6f5-feba-5126-8a1d-101b0e9cf790`**. Сотрудник в браузере принял его в работу и закрыл с `confirmed_fraud` (v3).
6. На Honor показаны ответ сотрудника, тот же transaction ID и баланс **4 546 500 ₸**.
7. Клиент отменил перевод с подтверждением. API и история веб-клиента показали **`cancelled`**, баланс сохранился. Само закрытие SOC-кейса не обходит финансовую политику.

[honor-e2e.json](evidence/live-staging/honor-e2e.json). Реальные скриншоты: [клиент](evidence/live-staging/honor26-client.png), [подтверждение перевода](evidence/live-staging/honor26-transfer-review.png), [Cooling-Off](evidence/live-staging/honor26-cooling.png), [ответ SOC](evidence/live-staging/honor26-soc-reply.png), [SOC на Honor](evidence/live-staging/honor26-admin.png), [платформа на Honor](evidence/live-staging/honor26-platform.png).

## Android candidate и роли

- `Saq-Bol-2.9-26-staging-candidate.apk`, **2.9 / code 26**, package `kz.qadamx.bccshield.demo`.
- API только `https://saq-bol-mobile-staging.onrender.com`.
- Исходники APK `904f84e2ec7332a18691cbfbbc4b8d43d544b86d`; backend не отличается от развёрнутого `c3f7703`.
- SHA-256 APK `8b7cb7d1c724bf3511c6b2175e30fd1a681bb9a072a09f87055758427241bfb2`.
- Сертификат SHA-256 `0dd732df01a3c1d98ec7b2ebfbd448b7d783080bfc784845676df8eb10aad0ab`.
- Проверены подпись, manifest, API origin, **40 UI-файлов** на соответствие исходникам. [candidate.json](evidence/live-staging/candidate.json).
- Дизайн Айданы сохранён. Отдельный verifier допускает только фиксированный staging origin; canonical verifier не ослаблен. Публичные APK/manifest/QR build 24 не заменены.

Настоящие login и защищённые API проверены для `client_demo`, `admin_demo`, `platform_demo`: роли client/admin/platform_admin. Неверный пароль → 401, клиенту SOC → 403. В браузере и на Honor проверены все три кабинета. После смены ролей возврат к клиенту не оставил административную навигацию. После force-stop и повторного запуска Android восстановил клиентскую сессию и баланс; SHA-256 установленного `base.apk` совпал с candidate. На телефоне оставлен клиентский главный экран. [device-and-roles.json](evidence/live-staging/device-and-roles.json), [экран после перезапуска](evidence/live-staging/honor26-restored-client.png).

## Тесты и границы результата

Текущий целевой прогон: **52 backend PASS + 50 Android JS PASS = 102 уникальных автоматических теста**, один SKIP (отдельный PostgreSQL advisory-lock тест без integration fixture). Ruff/mypy по изменениям и Gradle build — PASS. [Сводка тестов](evidence/live-staging/tests.json). Это **не повторный full-suite всего проекта**. Эмулятор не запускался из-за нехватки RAM; использован физический Honor.

GitHub Actions не зелёный: проверенные jobs отклонены из-за billing/spending limit. [Снимок CI](evidence/live-staging/ci.json). Тариф/лимит не менялся; нужны действие владельца и повторный CI. Локальные тесты не выдаются за успешный GitHub CI.

**Live Guardian — BLOCKED.** Пользователь подтвердил, что имеющийся бот — тот же основной `@bekzat_bcc_shield_test_bot`, занятый основным API. Второй polling не запускался, основной бот не перенастраивался, реальных сообщений в этой приёмке нет. PostgreSQL advisory lock ограничен одной базой и не предотвращает конкуренцию разных сервисов с одним ботом.

Для live нужен отдельный свободный тестовый бот либо согласованное владельцем окно переключения основного обработчика. Токен — только скрытый локальный ввод; затем подтверждение private chat и новое ограниченное согласие контакта на отправку. Fake PASS не заменяет live.

Перед публикацией candidate необходимы live-приёмка либо явно принятый демо-режим без live Telegram, CI/review техлида и решение о переключении публичного APK/QR. Старую временную историю `saq-bol-mobile` эта работа не переносила и не удаляла. **Production — NO-GO.**

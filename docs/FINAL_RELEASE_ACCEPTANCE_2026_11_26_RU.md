# Saq Bol — финальная приёмка 26 ноября 2026

**PARTIAL: постоянный staging с настоящим Guardian работает; единый публичный релиз пока не согласован.** Вечером новая операция выполнена на физическом Honor: 900 000 ₸ → HTTPS staging → настоящее Telegram-уведомление → ACK и подозрение → один SOC-кейс → решение сотрудника → результат и отмена на Honor. Только синтетические данные и виртуальные средства.

## Ревизии и релиз

- Проверенный код / deployed backend: `cee12aba7615ec1f09230b7586c464ad20249818`.
- Ветка `integration/final-build24`, [PR #37](https://github.com/foxfordkz-cyber/qadamxbcc/pull/37), OPEN / Draft, merge не выполнялся.
- Main при проверке: `ebb065fd85ea1313ec35fa383f3b41ba12184afe`.
- APK: 2.9 build 26, `kz.qadamx.bccshield.demo`, 10 760 760 байт.
- SHA-256: `8b7cb7d1c724bf3511c6b2175e30fd1a681bb9a072a09f87055758427241bfb2`.
- Certificate SHA-256: `0dd732df01a3c1d98ec7b2ebfbd448b7d783080bfc784845676df8eb10aad0ab`.
- APK source: `904f84e2ec7332a18691cbfbbc4b8d43d544b86d`; последующий fix backend не менял Android assets и дизайн Айданы.
- [Отдельный GitHub prerelease](https://github.com/foxfordkz-cyber/qadamxbcc/releases/tag/android-2.9-26-staging-candidate) опубликован; authenticated download сверялся по SHA. Репозиторий private: для скачивания нужен доступ. Это не подмена общедоступного build 24.
- SHA документационного коммита — в истории файла и HEAD PR; он не выдаётся за source APK.

## Новый физический сценарий

| Поле | Факт |
|---|---|
| Устройство | Honor X6 / VNE-LX1, build 26, обычный интернет без adb reverse |
| Transaction ID | `158a528c-ecf8-4ae7-8a41-f55f1405e97d` |
| Case ID | `e71876ad-5656-5bbc-bd5a-07b8edd35e94` |
| Получатель / сумма | Данияр А., синтетический знакомый получатель, 900 000 ₸ |
| Клиентский сигнал | На Honor выбран ответ «Иә, әлі сөйлесіп жатырмын» |
| Решение | COOLING_OFF; ACTIVE_CALL, AMOUNT_SPIKE, ML_RISK_UPLIFT |
| Баланс до / после | 4 546 500.00 ₸ / 4 546 500.00 ₸ |
| Guardian | Отдельный `saq_bol_staging_bekzat_bot`, настоящий Bot API |
| Audit | ACK 15:01:34 UTC; SUSPICION_REPORTED 15:02:10 UTC — отдельные события |
| SOC | Ровно один кейс; CLOSED / confirmed_fraud; первоначальное решение через разрешённый SOC API |
| Ноутбук SOC | После входа владельца реально открыты та же операция, сумма, причины риска, кейс v2 и журнал решения |
| Honor после SOC | Подозрение, ответ сотрудника, сумма и баланс видны в клиентской квитанции; клиент отменил перевод через UI |
| Итог | cancelled; деньги не списаны |
| Повтор запроса | Исходный request hash сверён приватно; тот же idempotency key вернул тот же UUID, список операций и баланс не изменились |

[Telegram audit](evidence/final-release-20261126/telegram-session-3-progress.json), [SOC/client result](evidence/final-release-20261126/live-soc-session3.json), [PostgreSQL и replay](evidence/final-release-20261126/live-postgres.json), [закрытие окна](evidence/final-release-20261126/telegram-session-3-closed.json).

Было новое явное согласие получателя: до 6 сообщений / 15 минут, с разрешением действий в его Telegram Web. Отправлены **3 настоящих сообщения**: приглашение, запрос согласия, уведомление. Callback обновляли уже существующее сообщение. В 15:04:49 UTC контакт штатно отозван; история сохранена. Основной бот не переключался.

**Граница PASS:** один физический Honor плюс настоящий Telegram Web на ноутбуке. Второй физический Telegram-телефон и непрерывное видео не использовались. После SUSPICION клавиатура исчезает: второй настоящий callback из UI не проверялся, дедупликация покрыта автоматическими тестами. Решение через кнопку веб-SOC для вечернего дела не повторялось после уже выполненного API-решения; веб-экран и журнал проверены реально. Финансовые права контакту не выдавались.

## PostgreSQL и backup

PASS: PostgreSQL 18, отдельная `saq_bol_staging`, ограниченная роль `saq_bol_staging_owner`, TLS verify-full, Alembic `0016_dispute_history`, Valkey DB 12. Hosted worker, callbacks и SOC используют staging. Основная `bcc_shield` не изменена.

Новая полная копия после реального Guardian восстановлена в `saq_bol_staging_restore_20261126_live` на том же существующем экземпляре. **25 таблиц / 8 373 строки**, все строки, колонки, constraints, индексы и связи совпали. Обе прежние restore-базы сохранены. Dump 557 258 байт; SHA-256 `97fe768956ee4052301f51660b3b1a44b0d04989a0f19ff09f08ddf8da9cc48c`. Dump и секреты находятся только в защищённом локальном хранилище.

[Полный restore](evidence/final-release-20261126/backup-after-guardian.json). Временный /32 удалён: Render показывает **0 разрешённых IP / External traffic not allowed / Save disabled** — [evidence](evidence/final-release-20261126/network-rule-closed.json).

Два реальных Render Restart service прошли **раньше сегодня**, сохранив UUID, баланс, историю, SOC и сессии: [первая приёмка](FINAL_LIVE_INTEGRATION_ACCEPTANCE_RU.md). Это не два новых рестарта после вечернего Guardian. Новые live-данные проверены restore. После рестарта самого Valkey возможен повторный вход. Free PostgreSQL истекает 20 декабря 2026.

## Исправления, тесты и CI

Fix `cee12ab`: старый Fake-контакт больше не перехватывает live advisory-доставку — test-режим выбирает подтверждённый контакт из allowlist. Локальный отказ до отправки отличён от неоднозначной ошибки провайдера; опасный повтор неизвестной отправки не добавлен. Финансовая FamilyApprovalPolicy и scoring не менялись.

Свежий вечерний прогон: **78 backend + 50 Android JS + 211 frontend = 339 уникальных PASS, 1 SKIP**. [Список тестов](evidence/final-release-20261126/evening-tests.json). SKIP — отдельный PostgreSQL fixture локального раннера. Более ранние 149 уникальных тестов сохранены отдельно и не прибавлены повторно. Это целевые suites, не новый полный backend/Docker/эмуляторный прогон.

[Свежий публичный API](evidence/final-release-20261126/public-api.json): три роли, неправильный пароль 401, client→SOC 403, SOC→staff 403, platform→client-data 403, database/redis/worker OK. Старые операции и баланс сохранились. Краткое отключение сети на физическом устройстве вечером отдельно не воспроизводилось.

GitHub CI: **BLOCKED — billing/spending limit**. Локальные PASS не являются CI PASS. Checks, тарифы и бюджет не менялись. #33/#35/#36 уже входят в #37; повторное включение тех же изменений не требуется. Авторство и дизайн Айданы сохранены.

## Сайт и каналы

| Поверхность | Backend / версия |
|---|---|
| Основной сайт /soc | `https://saq-bol-mobile.onrender.com/soc/` |
| Публичный APK | build 24, старый mobile; SHA `119355ceea55b6087c357006ae14b2f272a72de00538521948d68362ecdfebf1` |
| Candidate build 26 | `https://saq-bol-mobile-staging.onrender.com` |
| Staging wallet / SOC / Platform | Тот же постоянный staging |
| Отдельный Guardian | PostgreSQL `saq_bol_staging`, один hosted poller отдельного бота |
| Jury | Отдельный `saq-bol-jury`, не источник операций staging |

[Свежая маршрутизация](evidence/final-release-20261126/public-routing.json), [реально скачанный публичный APK](evidence/final-release-20261126/distribution.json). Сайт и candidate **не являются единым публичным релизом**. Cutover требует решения техлида о канале и старой истории. Второй физический скан QR в этой сессии — NOT TESTED.

## Реальные экраны

- [Вопрос о звонке](evidence/final-release-20261126/honor-live-call-question.png).
- [Нейтральное ожидание](evidence/final-release-20261126/honor-live-neutral.png).
- [Подозрение из Telegram на Honor](evidence/final-release-20261126/honor-live-guardian-suspicion.png).
- [Квитанция отмены](evidence/final-release-20261126/honor-live-cancelled-receipt.png).
- [Ответ SOC, UUID и баланс на Honor](evidence/final-release-20261126/honor-live-soc-result.png).
- [SOC Android](evidence/final-release-20261126/honor-evening-soc.png), [Platform Admin](evidence/final-release-20261126/honor-evening-platform.png).

Скриншот веб-SOC получен браузерным инструментом в текущей сессии. Непрерывного видео нет. Постороннее уведомление телефона исключено из Git evidence.

[Свежая проверка устройства](evidence/final-release-20261126/evening-device.json): три роли открыты реально. После проверки platform_admin пользователь переключился в другое приложение, автоматизация остановлена. Возврат к клиенту и повторный запуск после этой смены ролей вечером не завершены; прежний PASS восстановления сессии не выдаётся за новый прогон.

## Передача и питч

Использовать [staging wallet](https://saq-bol-mobile-staging.onrender.com/wallet/) и [staging SOC](https://saq-bol-mobile-staging.onrender.com/soc/), build 26. Локальные пароли: Win+R → `%LOCALAPPDATA%\QadamShield\Staging\Open-Staging-Logins.cmd`. Пароли старого mobile и jury не подставлять.

1. 0:00–0:30 — клиент, баланс, Данияр А., 900 000 ₸.
2. 0:30–1:00 — ответ о продолжающемся звонке, серверная пауза, ID.
3. 1:00–1:30 — после нового отдельного согласия контакта: Guardian ACK, затем подозрение.
4. 1:30–2:20 — сотрудник открывает тот же ID в staging SOC и принимает разрешённое решение.
5. 2:20–3:00 — результат на Android, отмена давления/перевода, неизменный баланс и квитанция.

Без новой live-сессии показывать сохранённую операцию выше либо отдельный Fake Adapter сценарий с явной надписью «имитация». Он не является live PASS.

Остаются: владелец GitHub устраняет billing; техлид review/merge #37 и решение о public cutover; команда записывает непрерывный дубль на двух телефонах. **Показ проверенного staging — GO с этими границами. Единый публичный релиз — NO-GO до cutover/CI/review. Production — NO-GO.**

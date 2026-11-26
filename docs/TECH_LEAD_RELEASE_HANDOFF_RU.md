# Передача техлиду: отдельный постоянный staging

26 ноября 2026. Ветка `integration/final-build24`, Draft PR #37. Merge в main не выполнен.

## Что можно проверить сейчас

1. Открыть [ready](https://saq-bol-mobile-staging.onrender.com/ready): HTTP 200.
2. Открыть [веб-кабинет staging](https://saq-bol-mobile-staging.onrender.com/wallet/). Все три demo-роли реально проверены. Не использовать пароль от другого сервиса по предположению.
3. Установить переданный **staging candidate build 26** поверх совместимого APK. Он подключён к этому же staging. Публичный build 24 остаётся на старом сервисе и не является staging-клиентом.
4. Найти операцию `fbe36620-a926-498b-b2a1-7dc2a776fdf4` и кейс `051bd6f5-feba-5126-8a1d-101b0e9cf790`: Android → SOC → Android уже пройден на Honor, финальный статус `cancelled`, баланс 4 546 500 ₸.
5. Проверить [отчёт](FINAL_LIVE_INTEGRATION_ACCEPTANCE_RU.md) и [полную restore-сверку](evidence/live-staging/backup-restore.json). Два рестарта API сохранили UUID, баланс, историю, кейс и сессии. Restore — отдельная база, снимок до поздней операции Honor.

## Конкретные оставшиеся действия

| Кто | Действие |
|---|---|
| Владелец тестового Telegram | Дать отдельного свободного бота через скрытый локальный ввод либо согласовать окно переключения основного polling. Текущий основной бот не трогаем. Затем private chat, отдельное согласие и live-тест с одним UUID |
| Владелец GitHub | Разрешить проблему billing/spending limit Actions и повторить CI. Автоматически менять оплату не разрешено |
| Техлид | Review PR #37; подтвердить live-результат или явно принять отсутствие live для конкретного демо |
| Владелец релиза | После приёмки согласовать переключение публичного APK/QR/backend. Сейчас build 24, старый сервис и его история сохранены |

Новый сервер, Supabase-проект и платный ресурс для выполненного staging не создавались. Уже имеющийся PostgreSQL Free истекает 20 декабря: дальнейшее хранение требует отдельного решения владельца до этой даты.

## Локальные данные для входа

На ноутбуке Бекзата: **Win+R → `%LOCALAPPDATA%\QadamShield\Staging\Open-Staging-Logins.cmd`**. Окно показывает три проверенных аккаунта именно `saq-bol-mobile-staging`; после просмотра нажать Enter. Пароли не размещаются в PR, APK, отчётах или скриншотах. DPAPI-хранилище другого стенда не подменено.

## Сценарий демонстрации без заявления live Telegram

Клиент на staging APK выбирает учебного получателя и подозрительную сумму → сервер ставит перевод на проверку → сотрудник открывает **тот же ID** в staging SOC → решение отображается в клиентском обращении → клиент отменяет операцию, баланс не меняется. Если показывается Guardian, явно обозначить **Fake Adapter**, пока не выполнена отдельная live-приёмка. Закрытие SOC-кейса не означает автоматический выпуск денег.

## Изменения для review

- `backend/scripts/prepare_staging.py`, `backend/scripts/start-persistent.sh`: изоляция target, TLS, безопасный первый bootstrap, сохранение истории на рестарте.
- `backend/app/mobile_gateway/hosted_worker.py`, `config.py`, `app.py`: opt-in hosted outbox/Telegram lifespan, остановка фоновых задач.
- `backend/tests/test_staging_runtime.py`: существенные guard/lifecycle риски.
- `deploy/render-staging-existing.yaml`: существующая отдельная БД/DB 12, установщик выключен.
- `android-app/android/app/build.gradle`, `android-app/scripts/release_tools.py`, `verify-staging-candidate.py`: build 26, отдельная проверка staging APK без подмены canonical release.
- `docs/evidence/live-staging/`: реальные UUID, restore и device evidence, без секретов.

GO: демонстрация постоянного staging и Client → SOC → Client с явным Fake Guardian. NO-GO: заявление о живой Telegram-доставке, публичная замена candidate без решения владельца, production.

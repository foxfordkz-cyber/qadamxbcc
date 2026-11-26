# Передача техлиду — проверенный постоянный staging

26 ноября 2026. Ветка `integration/final-build24`, Draft PR #37. Код `cee12ab`, merge не выполнен.

**Новое:** физический Honor → настоящий Telegram ACK и подозрение → один SOC-кейс → решение через SOC API → ответ и отмена на Honor. Ноутбук реально показывает тот же кейс, сумму и причины. [Подробная приёмка](FINAL_RELEASE_ACCEPTANCE_2026_11_26_RU.md), [матрица экосистемы](REAL_ECOSYSTEM_VERIFICATION_RU.md).

- Transaction `158a528c-ecf8-4ae7-8a41-f55f1405e97d`, case `e71876ad-5656-5bbc-bd5a-07b8edd35e94`, 900 000 ₸. Баланс до/после 4 546 500 ₸, cancelled. Точный replay не создал дубль.
- [Staging wallet](https://saq-bol-mobile-staging.onrender.com/wallet/), [SOC](https://saq-bol-mobile-staging.onrender.com/soc/), `/ready` 200. Не открывать SOC через главный сайт для этой операции: он пока ведёт в старый mobile.
- Build 26 — [отдельный GitHub prerelease](https://github.com/foxfordkz-cyber/qadamxbcc/releases/tag/android-2.9-26-staging-candidate). Private repo требует доступа; public сайт остаётся на build 24.
- Новая полная копия включает live-события: 25 таблиц / 8 373 строки, restore `saq_bol_staging_restore_20261126_live`. Две прежние restore-базы сохранены. Внешний /32 удалён, 0 разрешённых IP.
- Два Render restart прошли раньше сегодня; новые live-события проверены restore, не повторными вечерними restart.
- Свежие тесты: 78 backend + 50 Android JS + 211 frontend = 339 уникальных PASS, 1 SKIP. Предыдущие проверки не прибавлены повторно.

## Действия владельцев

| Кто | Конкретное действие |
|---|---|
| Владелец GitHub billing | Settings → Billing and licensing → Budgets and alerts: устранить причину Actions spending-limit/payment отказа, затем перезапустить checks PR #37. Бюджет автоматически не менялся |
| Техлид | Review #37, затем разрешённый обычный merge с сохранением авторства. #33/#35/#36 уже входят в эту ветку |
| Владелец релиза | Решить, публиковать ли отдельный ясно обозначенный staging-канал, и судьбу временной истории старого mobile. До решения основной сайт/QR/build 24 не переключать |
| Команда | Непрерывный дубль: два физических телефона и ноутбук; решение сразу кнопкой веб-SOC. Вечернее решение было API-действием; веб-кейс затем прочитан реально |
| Контакт Guardian | Для следующей отправки — новое ограниченное согласие. Завершённая live-сессия закрыта, согласие отозвано штатно |

Локальные пароли: Win+R → `%LOCALAPPDATA%\QadamShield\Staging\Open-Staging-Logins.cmd`. Использовать именно staging-учётные данные. Секретов в Git, APK, отчётах и screenshots нет.

Дизайн Айданы и финансовый движок сохранены. Основной `bcc_shield`, старый mobile и основной бот не изменялись. Новый сервер/платный ресурс/Supabase не создавались. Render PostgreSQL Free истекает 20 декабря 2026 — требуется решение владельца о дальнейшем хранении до этой даты.

# Проверка интеграции build 24, 25 ноября 2026

`verification.json` содержит результаты и способ подсчёта уникальных test ID.
`backend-test-ids.json` позволяет проверить дедупликацию полного прогона,
дополнительного PostgreSQL/Redis прогона и регрессии входящих изменений main.
Повторный запуск, отдельный assertion, сборка и публичный login не считаются
новым уникальным тестом.

- `guardian-storage.txt`: синтетический HTTP → Fake Guardian → SOC → квитанция,
  два рестарта API, проверка replay, полный PostgreSQL dump/restore.
- `native-final.txt`: миграции из четырёх исторических heads, downgrade/upgrade,
  ORM parity и конкурентные проверки PostgreSQL/Redis.
- `public-readonly.json`: фактические входы трёх ролей и отрицательный результат
  поиска прежнего UUID. Это **не** полная копия публичной базы.
- `telegram-readonly.json`: getMe/getWebhookInfo, без сообщений, polling и чтения
  обновлений. Это **не** live-проверка пользовательского сценария.
- `canonical-release.json` и `release.txt`: APK build 24,
  совпадение bytes/current/team, сертификат и pinned source.
- `public-release-final.json`, `public-qr-soc.json`: повторное скачивание после
  восстановления build 24 на сайте, программное декодирование фактического QR и
  redirect SOC на тот же mobile backend. Это не новая проверка камерой телефона.
- `release-guard.txt`: четыре дополнительных теста защиты публикации от downgrade.
- `android25-candidate.json`: отдельный собранный кандидат, не новый публичный релиз.
- `github-access.json`: доступ к branch protection/rulesets. HTTP 403 означает
  отсутствие подтверждения, а не отсутствие правила.

Физическую проверку телефона пользователь отменил. Новые скриншоты/видео Honor
здесь не заявляются. Снимки в соседней папке `ecosystem-24` — исторические.
Docker E2E и GitHub billing не подменяются местными PASS.

Временные неуспешные попытки перед исправлениями сохранены вне Git в рабочей
папке `work/final24-*.log`: устаревшие UI-селекторы, тест без учёта retry 503,
неверный номер изолированной Redis DB и неудачный запуск временного Redis.
Итоговые логи перечисляют только фактически завершённые проверки. Публичные
операции, credentials, env и deployment **Render backend** не изменялись.
Статический Cloudflare Worker обновлён отдельно для устранения возврата сайта
на build 22; актуальные командные изменения main и vars сохранены.

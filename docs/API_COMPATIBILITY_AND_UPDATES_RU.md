# API и обновления

## Контракт

`docs/contracts/ECOSYSTEM_OPENAPI.json` генерируется из реальных FastAPI OpenAPI core
и mobile, включая замкнутый набор `$ref`. Это проверяемая граница, не второй набор
ручных моделей. AccountView типизирует баланс строкой и сохраняет дополнительные поля.
Core Transfer/TransactionStatus, consent/notification, Guardian reports, SOC actions,
timeline и health используют существующие схемы; мобильные receipts и wallet-агрегации
остаются существующими проекциями. Snapshot ловит изменение контракта, но не заменяет
проверку семантики и интеграционные тесты клиента.

Команды из `backend`:

```powershell
python -m scripts.export_ecosystem_contract --check
python -m scripts.integration_check
python -m scripts.integration_check --storage
```

Нужны установленные Python/Node зависимости; storage-варианту нужен работающий Docker.
Скрипт не принимает URL публичного сервера и не создаёт там операции. Он проверяет
backend/RBAC/Guardian/идемпотентность и Android/frontend unit contracts.
UI: из `android-app` выполнить `npm run test:ui -- tests/browser/audit.spec.mjs tests/browser/soc-refresh.spec.mjs`.

## Политика версий

- Необязательные поля добавляются обратно совместимо; клиент допускает неизвестные поля.
- Переименование статуса, типа суммы или обязательного поля требует явной миграции API.
- `/mobile/v1/compatibility`: `api_major=1`, `minimum_android_build` из
  `BCC_MOBILE_MINIMUM_ANDROID_BUILD`, по умолчанию 0, чтобы не блокировать прежние APK.
- Клиент проверяет протокол перед входом/восстановлением. 404/405 старого сервера
  означает legacy, а не успешное подтверждение новой версии. 401/403/5xx не скрываются.
- Несовместимый major или слишком старый известный native build требует обновления.
  Нельзя следовать произвольному update URL из серверного ответа.
- Сначала обратно совместимый backend и миграция, затем клиенты; повышать minimum build
  только после публикации проверенного APK и оценки активных пользователей.

## Релиз

Сохранять package `kz.qadamx.bccshield.demo` и его совместимый signer. APK Айданы
`.dev` имеет другую подпись и пакет: это отдельная установка, не обновление `.demo`.
Версию увеличивать, если содержимое APK изменилось. Проверить source-to-APK assets,
версию/package/signature/SHA-256, установить `adb install -r` без очистки данных,
проверить вход и сессию. Затем сформировать current/team manifest существующим release
скриптом, обновить статический APK и проверить скачанные bytes. Постоянный QR ведёт на
`/download/android/`; менять QR при каждом build не требуется.

Не публиковать APK с изменениями, которые ещё не проверены на устройстве, как
«проверенный телефонный релиз». GitHub CI и локальные проверки отмечаются отдельно.

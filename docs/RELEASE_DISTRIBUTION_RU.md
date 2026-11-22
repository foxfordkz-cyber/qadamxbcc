# Выдача Android со страницы Saq Bol

Страница установки и QR имеют постоянный адрес. Страница читает URL файла, версию, минимальный Android, дату, размер и SHA-256 из [current.json](../frontend/public/downloads/current.json). Для кошелька сборщик создаёт ссылку на те же байты. [team.json](../frontend/public/downloads/team.json) сохраняет совместимость со старыми потребителями и должен совпадать с основным манифестом. [Страница установки](https://saq-bol-bcc.zerdeliportald.workers.dev/download/android/) · [QR](https://saq-bol-bcc.zerdeliportald.workers.dev/downloads/android-qr.svg)

| Предыдущая установка | Переход на 2.9, код 21 |
|---|---|
| `kz.qadamx.bccshield.demo`, командный сертификат | Обычное обновление поверх существующей версии с меньшим кодом. Сохраняется Android-хранилище приложения. |
| `kz.qadamx.bccshield.website`, код 16 и ранее | Установить новый пакет рядом со старым, войти в тот же аккаунт и сверить историю на сервере. Черновики и сеанс привязаны к старому пакету. Оставить его установленным, пока нужны локальные данные. |
| Чистый Android 7.0 (API 24) и новее | Установить проверенный APK и войти в учебный аккаунт. |

Выпуск 18 использует `kz.qadamx.bccshield.demo` и ранее принятую командную подпись. Закрытый ключ остаётся у сборщика. Архивный манифест старого публичного пакета расположен в [legacy-website-2.9.json](../frontend/public/downloads/legacy-website-2.9.json). У опубликованного файла и у кандидата разные неизменяемые URL. Результат проверки действующего сайта записан в [отчёте по выпуску](SAQ_BOL_FINAL_COMPLETION_RU.md).

## Подготовка выпуска

Используйте рабочую копию проверенной ревизии, JDK 21, Android SDK и существующий ключ команды. Для нового выпуска увеличьте versionCode и сначала проверьте тесты кошелька. Из корня репозитория выполните команды PowerShell.

```powershell
npm.cmd --prefix android-app ci
npm.cmd --prefix android-app run sync
Push-Location android-app/android
.\gradlew.bat assembleShowcase assembleDebug
Pop-Location
$sdkTools = Join-Path $env:ANDROID_HOME 'build-tools/36.0.0'
$source = git rev-parse HEAD
python android-app/scripts/stage-showcase.py android-app/android/app/build/outputs/apk/showcase/app-showcase.apk --channel team --source $source --sdk-tools $sdkTools --date (Get-Date -Format yyyy-MM-dd)
python android-app/scripts/verify-release.py --apksigner (Join-Path $sdkTools 'apksigner.bat')
```

Перед публикацией сравните SHA-256 скачанного APK и установленного пакета, проверьте вход и повторный запуск на физическом Android. После review и принятия изменений опубликуйте статику действующим workflow Cloudflare. Скачайте APK по кнопке с публичной страницы и ещё раз сравните размер, подпись и SHA-256 с манифестом. Для отката сайта восстановите предыдущий deployment. Для обновления уже установленного приложения понадобится следующий, больший versionCode.

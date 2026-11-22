# Выдача Android со страницы сайта

Основная кнопка и QR ведут на постоянную [страницу Android](https://saq-bol-bcc.zerdeliportald.workers.dev/download/android/). Обновление устанавливается поверх прежнего приложения своего канала. Сайт и кабинеты используют один сервер переводов. Локальные настройки и сеансы Android привязаны к идентификатору приложения.

| Где установлен предыдущий APK | Манифест | Пакет | Предыдущая сборка | Версия 2.9 |
| --- | --- | --- | --- | --- |
| Основной сайт | [current.json](../frontend/public/downloads/current.json) | `kz.qadamx.bccshield.website` | 2.7, код 13 или 2.9, коды 14–15 | Код 16 |
| Командный кошелёк, включая Honor | [team.json](../frontend/public/downloads/team.json) | `kz.qadamx.bccshield.demo` | 2.7, код 10, 2.8, код 11 или 2.9, код 13 | Код 17 в PR #30, опубликованный командный код 14 |

Для установки требуется Android 7.0 (API 24) или новее. Для опубликованного APK сайта с кодом 16 рекомендуется Android System WebView или Chrome с движком Chromium версии 103 или новее. Эта сборка показывает подсказку и ссылку на кошелёк в браузере, пока интерфейс загружается. Командный APK с кодом 17 открыл форму входа на чистом Android 11 с WebView 83. Для ранее установленной командной сборки 14 при пустом экране доступен [веб-кошелёк](https://saq-bol-mobile.onrender.com/wallet/).

Каждый манифест указывает исходную ревизию, сертификат, контрольную сумму и размер APK. Командный вариант `showcase` отключает отладку и использует существующую демонстрационную подпись Gradle из `signingConfigs.debug`. Поэтому совместимое обновление требует того же закрытого ключа сборщика. Разработчики запускают эксперименты в отдельном приложении `.dev`.

## Сборка и проверка

В рабочей копии нужного коммита выполните команды под JDK 21. На компьютере сборки требуется сохранённый ключ соответствующего канала.

```powershell
npm.cmd --prefix android-app ci
npm.cmd --prefix android-app run sync
Push-Location android-app/android
.\gradlew.bat assembleWebsite
Pop-Location
$sdkTools = Join-Path $env:ANDROID_HOME 'build-tools/36.1.0'
$source = git rev-parse HEAD
python android-app/scripts/stage-showcase.py android-app/android/app/build/outputs/apk/website/app-website.apk --channel website --source $source --sdk-tools $sdkTools --date (Get-Date -Format yyyy-MM-dd)
python android-app/scripts/verify-release.py --apksigner (Join-Path $sdkTools 'apksigner.bat')
```

Для командной сборки используйте `assembleShowcase`, `app/build/outputs/apk/showcase/app-showcase.apk` и `--channel team` на компьютере с ключом команды. Для нового APK увеличьте `versionCode`. Скрипт сверяет пакет и подпись с исторической сборкой выбранного канала, проверяет адрес сервера и сравнивает интерфейс APK с указанной ревизией.

После проверки установите APK поверх предыдущей версии через `adb install -r`. Убедитесь, что Android сохранил прежний пакет и открывает обновлённый кошелёк. Опубликуйте файл APK и манифест вместе со статической сборкой сайта. URL файла включает начало его SHA-256. Для возврата ссылок на прежний выпуск восстановите предыдущий deployment Cloudflare. Чтобы обновить уже установленный APK на устройстве, следующий выпуск должен иметь более высокий код версии.

Ветка PR #30 обновляет только командный манифест и его подписанный APK. Публичный файл сайта с кодом 16 проверен загрузкой по HTTPS. Его подпись и URL сохраняются. Для командного клиента с исправлением старого WebView проверены `stage-showcase.py --channel team` и `verify-release.py --apksigner`. Для приёмки используйте [team.json](../frontend/public/downloads/team.json).

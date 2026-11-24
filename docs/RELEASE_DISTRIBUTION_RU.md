# Выдача Android со страницы сайта

Основная кнопка и QR ведут на постоянную [страницу Android](https://saq-bol-bcc.zerdeliportald.workers.dev/download/android/). Обновление устанавливается поверх прежнего приложения своего канала. Сайт и кабинеты используют один сервер переводов. Локальные настройки и сеансы Android привязаны к идентификатору приложения.

| Где установлен предыдущий APK | Манифест | Пакет | Предыдущая сборка | Версия 2.9 |
| --- | --- | --- | --- | --- |
| Основная кнопка сайта и Honor | [current.json](../frontend/public/downloads/current.json), [team.json](../frontend/public/downloads/team.json) | `kz.qadamx.bccshield.demo` | Предыдущая командная сборка | Код 22 |
| Ранее установленная версия сайта | [legacy-website-2.9.json](../frontend/public/downloads/legacy-website-2.9.json) | `kz.qadamx.bccshield.website` | Предыдущая версия сайта | Код 16 |

Build 22 с дизайном Айданы собран из `aba72791fbe8ec02b17ffefffd7fb49ff67153ac`. Его SHA-256 — `83d2f7366a47a24b22904261602e729963a949697c17dca7fc050e5d3d7b48b5`. На Honor X6 файл в Download прочитан обратно по MTP, контрольная сумма совпала. Владелец телефона подтвердил установку и номер 22 в профиле. При наличии прежнего приложения с суффиксом .website новая командная версия устанавливается рядом с ним.

Для установки требуется Android 7.0 (API 24) или новее. Для входа и запросов к серверу нужен обновлённый Android System WebView или Chrome с движком Chromium версии 103 или новее. Сборка с сайта показывает подсказку об обновлении и ссылку на кошелёк в браузере, пока интерфейс не загрузился. На телефоне с более старым WebView командная сборка 14 может открыться без формы входа. В этом случае обновите WebView или откройте [командный веб-кошелёк](https://saq-bol-mobile.onrender.com/wallet/) в актуальном браузере.

Каждый манифест указывает исходную ревизию, сертификат, контрольную сумму и размер APK. Командный файл подписан и собран из указанной там ревизии. Разработчики запускают локальные эксперименты в отдельном приложении `.dev`.

## Сборка и проверка

В рабочей копии нужного коммита выполните команды под JDK 21. На компьютере сборки требуется сохранённый ключ соответствующего канала.

```powershell
npm.cmd --prefix android-app ci
npm.cmd --prefix android-app run sync
Push-Location android-app/android
.\gradlew.bat assembleShowcase
Pop-Location
$sdkTools = Join-Path $env:ANDROID_HOME 'build-tools/36.0.0'
$source = git rev-parse HEAD
python android-app/scripts/stage-showcase.py android-app/android/app/build/outputs/apk/showcase/app-showcase.apk --channel team --source $source --sdk-tools $sdkTools --date (Get-Date -Format yyyy-MM-dd)
python android-app/scripts/verify-release.py --apksigner (Join-Path $sdkTools 'apksigner.bat')
```

Для командной сборки используйте `assembleShowcase`, `app/build/outputs/apk/showcase/app-showcase.apk` и `--channel team` на компьютере с ключом команды. Для нового APK увеличьте `versionCode`. Скрипт сверяет пакет и подпись с исторической сборкой выбранного канала, проверяет адрес сервера и сравнивает интерфейс APK с указанной ревизией.

После проверки установите APK поверх предыдущей версии через `adb install -r`. Убедитесь, что Android сохранил прежний пакет и открывает обновлённый кошелёк. Опубликуйте файл APK и манифест вместе со статической сборкой сайта. URL файла включает начало его SHA-256. Для возврата ссылок на прежний выпуск восстановите предыдущий deployment Cloudflare. Чтобы обновить уже установленный APK на устройстве, следующий выпуск должен иметь более высокий код версии.

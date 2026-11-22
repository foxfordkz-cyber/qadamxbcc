# Открытие Saq Bol × BCC (Qadam Shield) в Android Studio

Принятые исходники 2.8 находятся в `mobile/android-studio-handoff`. Для работы со сборкой 2.9 клонируйте `main`. Точные ревизии исходников указаны в манифестах [APK с сайта](../frontend/public/downloads/current.json) и [командного APK](../frontend/public/downloads/team.json). Результаты установки и ограничения стенда приведены в [приёмке](FINAL_ACCEPTANCE_RU.md).

## Подготовка на Windows

Установите Node.js с npm (CI использует Node 22), Git, Android Studio, Android SDK Platform 36 и JDK 21. В репозитории закреплены Capacitor 8 через npm lockfile, Android Gradle Plugin 8.13.0 и Gradle Wrapper 8.14.3. Минимальный API телефона — 24. Для получения приватного репозитория нужен доступ GitHub к qadamxbcc.

В PowerShell из родительской папки:

```powershell
git clone --branch main https://github.com/foxfordkz-cyber/qadamxbcc.git
cd qadamxbcc
npm.cmd --prefix android-app ci
npm.cmd --prefix android-app run web
npm.cmd --prefix android-app run sync
```

В Android Studio выберите **File → Open → `android-app/android`** относительно корня клона. Выберите Gradle JDK 21 и нажмите **Sync Project with Gradle Files**. В конфигурации `app` выберите эмулятор или разрешённый тестовый телефон и нажмите Run. Альтернатива из корня клона:

```powershell
cd android-app/android
.\gradlew.bat assembleDebug assembleShowcase
cd ../..
```

APK лежит в `android-app/android/app/build/outputs/apk/debug/app-debug.apk`. Для разработки используется обычная локальная debug-подпись. Если подпись установленного на Honor приложения отличается, используйте отдельный эмулятор. Не удаляйте установленное приложение с пользовательскими данными ради проверки сборки.

### Проверенная сборка

Сборка 2.8 имеет versionCode 11 и package `kz.qadamx.bccshield.demo`. Проверенная цепочка на Windows использует JDK 21, SDK 36, Gradle Wrapper и npm ci. Вариант для демонстрации лежит в `app/build/outputs/apk/showcase/app-showcase.apk` относительно Android-проекта. Он отключает отладку и сохраняет подпись существующего учебного ключа на машине сборки. Debug APK другого разработчика может иметь другую подпись. Для обновления телефонов используйте переданный готовый APK.

## Где лежит приложение

- `android-app/www/connected.mjs` управляет входом, ролями и переходами. `wallet.mjs`, `wallet.css`, `connected.css` содержат разметку и стили. `copy.mjs` и подписи RU/KK в компонентах используются в обеих версиях кошелька.
- `android-app/www/gateway.mjs` отправляет запросы. `android-app/scripts` готовит локальные ресурсы, включая OCR, и версию кошелька для веб-сервера.
- `android-app/android/app/src/main` содержит Manifest, Activity, ресурсы и нативные плагины. Корень проекта Android Studio на два уровня выше этого каталога.
- `backend/app/mobile_gateway` применяет права клиента, SOC и администратора платформы. `backend/app/integrations/cases` хранит дела и историю ответов.
- После изменения UI выполните `npm.cmd --prefix android-app run sync` и снова запустите app. Для проверки того же экрана в браузере выполните также `npm.cmd --prefix android-app run web`.

## Окружения и доступ

APK по умолчанию использует `https://saq-bol-mobile.onrender.com`. Свой HTTPS origin задаётся **до сборки** через `$env:QADAM_API_ORIGIN`. Пароли отсутствуют в настройках сборки. За тестовым доступом к публичному мобильному сервису обратитесь к Бекзату по закрытому каналу. Публичный jury-стенд обслуживает другие комнаты и аккаунты. Клиенту приложения нужны только логин и пароль.

Для заполненной репетиции на ноутбуке используйте [демоданные и сценарии](DEMO_DATA_RU.md). По умолчанию этот изолированный кошелёк доступен на loopback в браузере ноутбука. На физическом телефоне обычная сборка по-прежнему покажет публичную базу. Подключение к собственному доступному HTTPS-стенду требует сборки с его origin.

При пустом экране проверьте синхронизацию Capacitor после изменения файлов и версию APK. При HTTP 401 проверьте соответствие файла доступа адресу стенда. HTTP 403 означает отказ серверной роли. При ошибке SDK установите Platform 36 и укажите установленный SDK в настройках Android Studio. Файл local.properties, ключи и пароли остаются на компьютере разработчика.

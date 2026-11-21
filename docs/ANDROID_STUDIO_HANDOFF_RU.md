# Открытие Qadam Shield 2.7 в Android Studio

Исходники версии 2.7 (versionCode 10, пакет debug `kz.qadamx.bccshield.demo`) передаются в [ветке mobile/android-studio-handoff](https://github.com/foxfordkz-cyber/qadamxbcc/tree/mobile/android-studio-handoff). Основа — линия установленного на Honor релиза и аудит входа `6f65754`. Ветка сохраняет историю разработки. На saq-bol-mobile работает серверная ревизия `2ffc009`.

## Подготовка на Windows

Установите Node.js с npm (CI использует Node 22), Git, Android Studio, Android SDK Platform 36 и JDK 21. В репозитории закреплены Capacitor 8 через npm lockfile, Android Gradle Plugin 8.13.0 и Gradle Wrapper 8.14.3. Минимальный API телефона — 24. Для получения приватного репозитория нужен доступ GitHub к qadamxbcc.

В PowerShell из родительской папки:

```powershell
git clone --branch mobile/android-studio-handoff https://github.com/foxfordkz-cyber/qadamxbcc.git
cd qadamxbcc
npm.cmd --prefix android-app ci
npm.cmd --prefix android-app run web
npm.cmd --prefix android-app run sync
```

В Android Studio выберите **File → Open → `android-app/android`** относительно корня клона. Выберите Gradle JDK 21 и нажмите **Sync Project with Gradle Files**. В конфигурации `app` выберите эмулятор или разрешённый тестовый телефон и нажмите Run. Альтернатива из корня клона:

```powershell
cd android-app/android
.\gradlew.bat assembleDebug
cd ../..
```

APK лежит в `android-app/android/app/build/outputs/apk/debug/app-debug.apk`. Для разработки используется обычная локальная debug-подпись. Если подпись установленного на Honor приложения отличается, используйте отдельный эмулятор. Не удаляйте установленное приложение с пользовательскими данными ради проверки сборки.

### Проверенная сборка

На Windows в отдельном checkout выполнены `npm ci`, подготовка web-версии, `cap sync android` и `gradlew.bat --offline --max-workers=1 assembleDebug`. Отработали 183 задачи Gradle. В APK сверены все 28 отслеживаемых файлов из `android-app/www`. Использованы Node 24.21.0, npm 11.19.0, Capacitor Core/CLI 8.6.2 и SDK 36. Debug APK 2.7 установлен с сохранением данных на Honor VNE-LX1. Android подтвердил холодный старт главной Activity. APK обращается к публичному мобильному API. Скриншоты заполненной репетиции сделаны в браузере отдельного локального стенда.

В этой сборке Gradle запускался через комплектный JBR 25.0.3 из `C:\Program Files\Android\Android Studio\jbr`. Пути к SDK и JDK на машине Айданы задаются локально.

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

# Выдача Android со страницы сайта

Для команды и QR предусмотрен URL https://saq-bol-bcc.zerdeliportald.workers.dev/download/android/. Доступность страницы на публичном домене фиксируется в FINAL_ACCEPTANCE_RU.md. Страница и обе точки входа сайта читают frontend/public/downloads/current.json при сборке. Файл публикуется вместе с сайтом по пути, содержащему часть SHA-256. Смена версии требует выпуска сайта одним набором статических файлов. Для отката восстановить предыдущий deployment Cloudflare целиком.

У Honor 2.8 установлен kz.qadamx.bccshield.demo, код 11, минимальный API 24. Публичный APK 2.7 имел отдельный суффикс .website и код 12 из сборки с QADAM_WEBSITE_APK. Архивная сборка .demo 2.7 имела код 10. Каноническая 2.9 использует .demo, код 14 и showcase с отключённой отладкой. Debug имеет отдельный .dev. Сертификат принятой учебной сборки находится в паспорте. Для повторной сборки showcase требуется тот же локальный ключ подписи.

Сборка из копии исходной ревизии под JDK 21:

```powershell
npm.cmd --prefix android-app ci
npm.cmd --prefix android-app run sync
Push-Location android-app/android
.\gradlew.bat assembleDebug assembleShowcase
Pop-Location
```

Для выпуска передать подписанный showcase, SHA коммита его исходников, дату и каталог SDK Build Tools в android-app/scripts/stage-showcase.py. Скрипт проверяет пакет, подпись, origin, ресурсы UI и отсутствие отладки. После проверки он записывает APK и переключает current.json в рабочей копии. Запустить python android-app/scripts/verify-release.py --apksigner с путём к SDK, собрать сайт, пройти установку, проверить QR и только затем публиковать сайт. Непрошедший приёмку кандидат остаётся в рабочей ветке. Ключ исключён из передачи.

Владельцу приложения .website следует сохранить локальные черновики в старой установке, установить .demo рядом и заново войти на том же сервере. Android изолирует локальные данные пакетов. Для совместимого .demo применяется обычное обновление поверх приложения.


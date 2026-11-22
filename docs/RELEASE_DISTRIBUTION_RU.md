# Выдача Android со страницы сайта

Для команды и QR предусмотрен URL https://saq-bol-bcc.zerdeliportald.workers.dev/download/android/. Доступность страницы на публичном домене фиксируется в FINAL_ACCEPTANCE_RU.md. Страница и обе точки входа сайта читают frontend/public/downloads/current.json при сборке. Файл публикуется вместе с сайтом по пути, содержащему часть SHA-256. Смена версии требует выпуска сайта одним набором статических файлов. Для отката восстановить предыдущий deployment Cloudflare целиком.

Проверка `aapt dump badging`, `aapt dump --values resources` и `apksigner verify --print-certs` дала следующие результаты. Во всех трёх APK минимальный Android API равен 24, отладка приложения отключена, мобильный origin равен `https://saq-bol-mobile.onrender.com`.

| Файл | Идентификатор Android | Код | SHA-256 сертификата подписи |
|---|---|---|---|
| 2.7 с сайта | `kz.qadamx.bccshield.website` | 12 | `9b1f9012a2e6d8b26f8d68110eeb171d69844e94181aa38bea6133e34c3af00f` |
| 2.8 для Honor | `kz.qadamx.bccshield.demo` | 11 | `0dd732df01a3c1d98ec7b2ebfbd448b7d783080bfc784845676df8eb10aad0ab` |
| 2.9 showcase | `kz.qadamx.bccshield.demo` | 15 | `0dd732df01a3c1d98ec7b2ebfbd448b7d783080bfc784845676df8eb10aad0ab` |

Публичная 2.7 собиралась с флагом `QADAM_WEBSITE_APK`. Архивная 2.7 с суффиксом `.demo` имела код 10. Для повторной сборки showcase требуется тот же локальный ключ подписи. Debug 2.9 устанавливается как отдельное приложение `kz.qadamx.bccshield.dev`. Контрольные суммы самих установочных файлов приведены в [акте приёмки](FINAL_ACCEPTANCE_RU.md).

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


# Saq Bol — публичное демо по ссылке

## Действующий стенд на Cloudflare и Render

[Сайт](https://saq-bol-bcc.zerdeliportald.workers.dev/) работает на Cloudflare Workers. [FastAPI](https://saq-bol-api.onrender.com/health), PostgreSQL и Redis развёрнуты на Render. Оба хостинга используют бесплатные ресурсы. В публичном интерфейсе доступны синтетические переводы и три пресета.

1. В Render создать Blueprint из ветки `main` с путём `deploy/render-api.yaml`. В нём веб-сервис, закрытая PostgreSQL и закрытый Key Value. После запуска `/health` возвращает 200. Для `/ready` нужен заголовок `X-BCC-SOC-Key`.
2. Из `frontend/` на Node 22.12+ выполнить `npm ci`, `npm run build:cloudflare` и `npm run test:cloudflare`. В `wrangler.jsonc` указаны адрес Render, разрешённый HTTPS origin приложения и идентификаторы демонстрационных счетов.
3. Опубликовать Worker командой `npm run deploy:cloudflare`. Скопировать значения Render `BCC_API_KEY` и `BCC_SOC_API_KEY` в секреты именно этого Worker под именами `BCC_DEMO_UPSTREAM_API_KEY` и `BCC_DEMO_UPSTREAM_SOC_KEY`. Wrangler принимает значения через защищённый ввод. Публичный JavaScript и Git содержат только адреса и синтетические идентификаторы. После изменения кода фронтенда повторить сборку и публикацию. GitHub Actions проверяет сборку и маршруты Worker.
4. Проверить на сайте три пресета и открыть выданную операцию в SOC. При выпуске 20 ноября 2026 через публичный Worker получены `approved` (0), `cooling_off` (74), `blocked` (100), реальная версия модели `bcc-synthetic-rf-v2`, лента и граф. Прямые запросы к данным FastAPI без ключа получили 401.

После простоя бесплатный web service Render засыпает, холодный старт может занимать больше времени, чем один запрос frontend. Перед демонстрацией открыть `/health`, дождаться ответа и загрузить мобильный экран. Бесплатная PostgreSQL имеет ограниченный срок хранения. [Условия бесплатных ресурсов Render](https://render.com/docs/free).

Клиентский экран доступен по `/mobile`, публичное рабочее место SOC — по `/soc`. Cloudflare передаёт в Render псевдоним сетевого адреса, вычисленный с помощью HMAC. Redis разрешает 20 новых запросов оценки за 60 секунд с одного адреса. Следующий новый запрос получает HTTP 429 и время ожидания в `Retry-After`. Ограничение касается отправки новых операций. Отзыв и просмотр удержанного перевода доступны во время паузы. Участники за одним NAT делят лимит. SOC показывает число действующих пауз и накопленный счётчик отклонённых запросов с момента создания счётчика в Redis.

Для тестовых Telegram-чатов используется [бот доверенного контакта](https://t.me/bekzat_bcc_shield_test_bot). Команда `/connect` в привязанном личном чате выдаёт код входа на 3 минуты. Сеанс сайта действует 15 минут и открывает доверенный круг назначенного синтетического счёта. Привязки хранятся в Render. [Настройка Telegram](integrations/TELEGRAM_BOT_SETUP.md).

20 ноября 2026 после включения бота проверены защищённый `/api/v1/integrations/health` (PostgreSQL, Redis и worker вернули `ok`) и `getMyCommands` Telegram (по 13 команд в локалях `ru` и `kk`). Сервер работает на одном бесплатном экземпляре. Вход в тестовый чат и согласие получать уведомления о конкретном переводе — отдельные действия.

## Статическая сборка

На 21 ноября 2026 года GitHub Pages выключен в этом репозитории. Публичный стенд работает на Cloudflare Workers и Render. При изменениях в `frontend/` или в самом `.github/workflows/pages.yml` публикация в `main` запускает сборку для ветки `gh-pages`.

Статическую версию можно открыть локально. В `frontend/` выполните `node scripts/build-pages.mjs` и раздайте папку `pages-out` по пути `/qadamxbcc/` через статический HTTP-сервер. Доступны страницы `/`, `/mobile/` и `/pitch/`. Демо-движок TypeScript рассчитывает риск в браузере, а история хранится в `localStorage`. Для проверки серверной ML-модели и Telegram используйте основной стенд.

## Сайт и API в одном контейнере Render

Корневой `render.yaml` запускает альтернативную конфигурацию. Внутри `deploy/Dockerfile` вместе работают Next и API, который слушает `127.0.0.1`. Используется режим `demo` с синтетическими данными.

Самый короткий путь — ссылка
<https://render.com/deploy?repo=https://github.com/foxfordkz-cyber/qadamxbcc>:
войти в Render, проверить три ресурса и нажать **Apply**. То же вручную:

1. Войти на [render.com](https://render.com) через GitHub и дать доступ к репозиторию
   `foxfordkz-cyber/qadamxbcc`.
2. **New → Blueprint** → выбрать репозиторий, ветку `main`. Render прочитает `render.yaml`
   и создаст три ресурса: сайт `saq-bol`, базу `saq-bol-db`, Key Value `saq-bol-cache`.
3. **Apply.** Первая сборка идёт 5–10 минут: Docker собирает фронтенд и обучает модель.
4. Ссылка вида `https://saq-bol.onrender.com` появится на странице сервиса. Публичный адрес
   контейнер берёт сам из `RENDER_EXTERNAL_URL` — вручную ничего настраивать не нужно.

Особенности бесплатного плана Render: сайт засыпает после 15 минут без запросов, первое
открытие после сна — до минуты; бесплатная база удаляется через 30 дней. **Перед защитой
откройте сайт за 2–3 минуты до выступления.** Для защиты надёжнее платный Starter.

## Railway

1. **New Project → Deploy from GitHub repo** → `qadamxbcc`.
2. В настройках сервиса: Dockerfile path `deploy/Dockerfile`.
3. Добавить плагины **PostgreSQL** и **Redis**; Railway сам передаст `DATABASE_URL` и `REDIS_URL`.
4. **Settings → Networking → Generate Domain.** Адрес контейнер возьмёт из `RAILWAY_PUBLIC_DOMAIN`.

## Любой сервер с Docker

```bash
docker build -f deploy/Dockerfile -t saq-bol .
docker run -d -p 80:3000 \
  -e DATABASE_URL=postgresql://USER:PASS@HOST:5432/DB \
  -e REDIS_URL=redis://HOST:6379/0 \
  -e BCC_DEMO_PUBLIC_ORIGIN=https://your-domain.kz \
  saq-bol
```

HTTPS обеспечивает прокси перед контейнером (Caddy, nginx). `BCC_DEMO_PUBLIC_ORIGIN` — точный
адрес, который видит браузер; запросы с других сайтов отклоняются (`403`).

## Переменные

| Переменная | Откуда | Зачем |
|---|---|---|
| `DATABASE_URL` | хостинг | PostgreSQL; `postgres://` переводится в `postgresql+asyncpg://` при старте |
| `REDIS_URL` | хостинг | счётчики скорости и проверки звонков |
| `PORT` | хостинг | порт сайта (по умолчанию 3000) |
| `BCC_DEMO_PUBLIC_ORIGIN` | сам из `RENDER_EXTERNAL_URL` / `RAILWAY_PUBLIC_DOMAIN`, или вручную | HTTPS-адрес сайта для проверки Origin |

Ключи `BCC_API_KEY`, `BCC_SOC_API_KEY` в демо не задаются: фронтенд откажется запускаться с
ключами вне режима `pilot`. Закрытый пилот с паролем — отдельная конфигурация
(`docker-compose.pilot.yml`, [PILOT.md](PILOT.md)).

## Что проверено

Контейнер не собирался в этой среде (нет Docker-демона). Сценарий `deploy/start.sh` прогнан
напрямую с адресом базы в формате Render (`postgres://…`) и `RENDER_EXTERNAL_URL`:
миграции и демо-данные на пустой базе, `/health` сайта, три пресета через сайт с публичным
Origin (`approved` 0 / `cooling_off` 74 / `blocked` 100), запрос с чужого Origin — `403`,
«Банк мне звонит?», лента SOC, страницы `/`, `/mobile`, `/pitch` — `200`, браузерный
сценарий — 97 из 97, API снаружи контейнера недоступен. Первую сборку на Render нужно
проверить после подключения.

## Перед показом / Көрсетілім алдында

Из корня запустите `node scripts/warm-wallets.mjs`. Команда ждёт готовности БД и Redis двух учебных стендов до минуты. Адреса берутся из [конфигурации](../frontend/src/lib/connected-wallet.json). Страница входа на основном сайте остаётся доступной, пока Render запускается. При прямом переходе на домен спящего Render начальный ответ отдаёт сам хостинг.

Алдын ала `node scripts/warm-wallets.mjs` пәрменін орындаңыз. Негізгі сайт әмиянды сервер дайын болғанда ашады. Желі істемесе, көрсетілімге дейін жергілікті стендті іске қосыңыз.

```sh
docker compose -f docker-compose.jury.yml up -d --build --wait
docker compose -f docker-compose.jury.yml run --rm --publish 127.0.0.1:18003:8000 wallet python -m scripts.jury_wallet
```

Откройте [локальную комнату жюри](http://localhost:18003/jury). Жергілікті бөлменің жеке оқу тарихы бар.

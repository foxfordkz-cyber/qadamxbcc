# Saq Bol — публичное демо по ссылке

Один контейнер (`deploy/Dockerfile`) запускает сайт и API; PostgreSQL и Redis даёт хостинг.
API слушает только `127.0.0.1` внутри контейнера, снаружи доступен лишь сайт.
Режим — `demo`: синтетические данные, демо-кнопки и `/pitch` включены, ключи не нужны.

## Render (бесплатно, 5 минут)

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

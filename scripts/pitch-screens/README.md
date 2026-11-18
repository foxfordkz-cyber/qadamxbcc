# Питч на 10 слайдов со скриншотами

`deliverables/BCC-Shield-pitch-ru.pptx` и `BCC-Shield-pitch-kk.pptx` — питч, где каждый слайд построен на настоящих экранах продукта (телефон, анкета удержания, доверенное лицо, SOC, граф, QR для жюри). Восьмислайдовые `BCC-Shield-ru/kk.pptx` из `build-pitch.mjs` не тронуты: там экономика и справедливость.

Тексты берутся из `frontend/src/content/pitch.json` (problem, decisions, pipeline, proof, pilot, ask) и из словаря в `build.js`; заметки докладчика — в каждом слайде.

Пересборка (снято 18.11.2026 на синтетических демо-данных):

1. Поднять бэкенд с интеграциями Бекзата (после шага 3) локально и фронтенд в live-режиме на `:3105` с `BCC_INTEGRATIONS_SIGNING_KEY`. `reset.sh <имя контакта>` пересоздаёт демо-базу и подключает доверенное лицо через симулятор; `deliver_once.py` — один проход воркера фейкового Telegram. Пути к бэкенду в `reset.sh`/`capture.cjs` — локальные, поправьте под себя.
2. `node capture.cjs ru` и `node capture.cjs kk` (Playwright) → PNG в `/tmp/cap/<lang>`.
3. `python3 prep.py` → рамки телефона и обрезка в `/tmp/deckbuild/img`.
4. `APPLY_THEME=<pptx skill>/scripts/apply_theme.js node build.js /tmp/deckbuild/img frontend/src/content/pitch.json deliverables` (нужен `pptxgenjs`).

После пересборки откройте все 20 слайдов: проверьте переносы казахского текста и что картинки не наезжают на колонтитул.

## HTML-нұсқа (қазақша, анимациямен)

`deliverables/BCC-Shield-pitch-kk.html` — бір файл, суреттер ішінде (WebP), интернетсіз ашылады. Басқару: ← → / бос орын / свайп / басу, F — толық экран, N — баяндамашы жазбалары. Әр слайдтың өз өтуі бар (zoom, slide, rise, flip), элементтер кезекпен шығады. Жүйеде «азырақ қозғалыс» қосулы болса, анимациялар өшеді.

Пересборка: `prep.py`-дан кейін суреттерді WebP-ке айналдырып `/tmp/deckbuild/web`-ке салыңыз, содан соң `python3 html_build.py frontend/src/content/pitch.json deliverables/BCC-Shield-pitch-kk.html` (`template.html` жанында болуы керек).

# Mobile client handoff

The mobile role in the five-person team split is implemented in `src/components/transfer-phone.tsx`, `cooling-modal.tsx`, `mobile-client.css` and their state wiring in `shield-app.tsx`. The shared typed Kazakh/Russian copy lives in `src/lib/mobile-copy.ts`; the rest uses the existing locale provider. No participant name is assumed for this role.

The phone follows the bcc.kz order: debit card (#картакарта •••• 4821, demo balance labelled "демо") → recipient (phone/card/IBAN, horizontal quick contacts) → amount (grouped digits, quick amounts, demo fee) → a confirmation step showing recipient, card, fee, crediting and total → receipt. "Continue" only validates and opens the confirmation; the evaluation request is sent from "Перевести N ₸" (`.transfer-confirm`). Manual context switches and the sender UUID live in the collapsed "Контекст демо" block; UUIDs, latency, ML and biometrics are shown in the adjacent "Решение Saq Bol" panel. The receipt shows the authoritative approved, held, blocked or cancelled state, amount, masked recipient, short operation number (full ID in `data-transaction-id` and the side panel) and the next action. A new transfer requires its explicit button; unknown outcomes show an in-phone warning, keep the existing recovery controls and block new intents. See `docs/DESIGN_SYSTEM.md` for sources and design decisions.

Cooling is a three-stage security sheet: explanation, five explicit yes/no questions, then an editable review. Keyboard focus moves to the stage heading; native radio navigation, dialog focus trapping, Escape-to-leave-held and focus restoration remain available. The primary button cannot advance an unanswered question. Kazakh/Russian switching preserves answers. Motion is disabled when the OS requests reduced motion.

The server alone controls the 15-minute hold. Clean answers may be saved before expiry but cannot release the transfer early. Timer expiry never sends a request. Explicit confirmation after expiry still requires a server decision. Cancel stays a durable server action. The sheet refreshes details on visibility/focus and every 15 seconds. A lost mutation response is checked through GET using the same operation ID, including a committed questionnaire that remains held.

The client saves the selected transaction UUID and a separate draft of the five boolean answers per transaction and synthetic account. Reopening performs a detail GET before showing the receipt or the cooling sheet. Drafts expire on read after 24 hours. A matching server save or a terminal state clears the draft. Failed local saves show a warning. The server remains authoritative for the deadline, status and submitted answers.

Stable QA selectors: `.phone-form .transfer-cta`, `.phone-confirm .transfer-confirm`, `.transfer-edit`, `.phone-receipt[data-transaction-id]`, `.receipt-review`, `.receipt-new`, `dialog.mobile-cooling[data-step="intro|question|review"]`, `.cooling-start`, `.cooling-next`, `.cooling-back`, `.cooling-review-list`, `.cooling-edit`, `.cooling-submit`, `.sheet-close`. Radio names match the five API questionnaire keys. The labelled countdown uses `role="timer"`.

Focused regression tests in `tests/cooling-flow.test.ts` and `tests/mobile-session.test.ts` cover explicit negative answers, incomplete questionnaires, reopening drafts, operation isolation, safe field filtering, bounded retention, active-case pinning, saved-answer provenance and cancellation reconciliation. Run the full `npm run typecheck`, `npm run test`, and `npm run build` before release. Browser QA should additionally exercise clean answers through the strict hold, red flags, cancellation, response loss, reload, live language switching, keyboard-only navigation, and narrow screens against isolated test data.

## /mobile — the phone on a real smartphone

`/mobile` renders the same `App` from `shield-app.tsx` with `layout="phone"`: only the phone screen at full width, without the bezel, the fake status bar, the "Решение Saq Bol" panel, the demo presets and the SOC tab. Logic is not duplicated: recovery, the cooling sheet, drafts and ҚАЗ/РУС work exactly as on `/`. `TransferPhone` takes `bare` for this mode; styles are the `.phone-stage.is-bare` / `.mobile-shell` block at the end of `mobile-client.css` (safe areas, sticky tab bar, `interactive-widget=resizes-content` so the keyboard does not cover "Продолжить").

`src/app/manifest.ts` (start URL `/mobile`, theme `#00A859`, icons in `public/icons/`, `apple-icon.png`) lets the page be added to the home screen and open full-screen.

The SOC header has a QR button ("Открыть на телефоне"). It encodes `<this origin>/mobile`; when the SOC is opened on `localhost`, it asks `GET /mobile/link` for the laptop's private Wi-Fi address. In the pilot it uses `BCC_PUBLIC_ORIGIN`.

Demo on the defence (phone and laptop on the same Wi-Fi):

```bash
# from frontend/, after npm run build; backend running as usual
BCC_MOBILE_LAN=true npx next start -H 0.0.0.0 -p 3105
```

`BCC_MOBILE_LAN=true` (local/demo only, ignored in the pilot) does two things: `/mobile/link` returns the laptop's RFC 1918 addresses, and the CSRF check in `server-access.ts` also trusts the laptop's own private IP as Host — the request `Origin` must still equal that Host, cross-site requests are still refused. Without the flag the phone can open the page but every transfer is rejected with 403. Windows may ask to allow Node.js in the firewall for private networks; guest/hotel Wi-Fi with client isolation will not work — use a phone hotspot instead.

Browser QA (`scripts/qa-mobile-soc.cjs`) checks `/mobile` at 390 px: phone-only layout, no bezel, no horizontal overflow, manifest link, language switch, the confirm button on screen, a transfer through the mocked API and the cooling sheet fitting the screen. Real-device checks still needed before the defence: iPhone Safari and Android Chrome — keyboard vs. "Продолжить", the cooling timer running, ҚАЗ/РУС, and the transfer appearing in the SOC feed on the laptop.

### Plain-http LAN pages (jury phone, Android app)

`http://192.168.x.x:3105/mobile` is not a secure context, so the browser withholds `crypto.randomUUID`, `crypto.subtle` and `navigator.locks`; before this fix every transfer from a real phone stopped with `recoveryUnavailable`. `src/lib/secure-fallback.ts` covers that case only: a v4 UUID from `getRandomValues`, a plain SHA-256 that yields the same draft key, and an in-page lock instead of the cross-tab Web Lock. In a secure context nothing changes, and a missing Web Lock there still fails closed. The limit: on a plain-http phone two tabs are not serialized against each other; server idempotency by `request_id` still prevents a repeated send of the same attempt. QA covers it with `mobile_route_transfer_works_in_insecure_lan_context`.

## Клиентский сценарий на /mobile

На главной доступны перевод, доверенный круг и проверка сообщения. Для перевода выберите получателя и сумму, проверьте реквизиты и подтвердите. Квитанция показывает решение сервера. В Cooling-Off можно ответить на вопросы, оставить перевод на удержании или отменить его. Срок берётся из ответа сервера.

### Настройка общего демо

Для свежего синтетического окружения задайте `BCC_INTEGRATIONS_ENABLED=true`, `BCC_INTEGRATIONS_TELEGRAM_MODE=fake` и случайный серверный `BCC_INTEGRATIONS_SIGNING_KEY` длиной не менее 32 символов. Запустите общий стек командой `docker compose -f docker-compose.yml -f docker-compose.integrations.yml --profile integrations up --build -d`. Используйте URL фронтенда из `docker compose ps`, открыв путь `/mobile`. Обе серверные части получают ключ из окружения. Клиентское приложение использует владельца синтетического счёта из серверной настройки `BCC_NORMAL_SENDER_ID`. В pilot управление контактами закрыто до подключения клиентской авторизации.

Владелец создаёт приглашение в разделе «Доверенный круг». Команда для привязки отображается один раз до истечения срока. Получатель отдельно подтверждает согласие. Активными считаются ожидающие и подтверждённые контакты, лимит равен трём. Для уведомления откройте удержанную операцию и выберите одного согласившегося получателя. Статус доставки отображается для этого ID перевода. Опрос выполняется раз в четыре секунды до конечного статуса, при 429 учитывается Retry-After. В тестовом окружении подпись FAKE указывает на адаптер доставки.

Scam Check ищет признаки в тексте RU/KK на устройстве. Исходный текст очищается после проверки. Пять дополнительных вопросов, их интерпретация и рекомендации загружаются через `GET /api/v1/scam-check/guide` из общего модуля Telegram Guardian. При недоступности API текстовая проверка продолжает работать. Сервис не присваивает переводу банковский статус.

### Проверка

Из каталога `frontend` выполните `npm test`, `npm run typecheck` и `npm run build`. Для браузерной проверки подготовьте отдельную базу с синтетическими пресетами, установите Chromium для Playwright, задайте `BCC_QA_SYNTHETIC=1` и запустите `node scripts/qa-client-journey.cjs http://localhost:3105`, подставив порт стенда. При необходимости путь к Chromium можно задать через `CHROMIUM_PATH`. Проверка создаёт и отменяет тестовые переводы. Для приёмки тремя участниками сверьте ID одной операции в приложении, уведомлении Fake Adapter и SOC Timeline.

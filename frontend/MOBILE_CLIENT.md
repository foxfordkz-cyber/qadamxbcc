# Mobile client handoff

The mobile role in the five-person team split is implemented in `src/components/transfer-phone.tsx`, `cooling-modal.tsx`, `mobile-client.css` and their state wiring in `shield-app.tsx`. The shared typed Kazakh/Russian copy lives in `src/lib/mobile-copy.ts`; the rest uses the existing locale provider. No participant name is assumed for this role.

The phone follows the bcc.kz order: debit card (#картакарта •••• 4821, demo balance labelled "демо") → recipient (phone/card/IBAN, horizontal quick contacts) → amount (grouped digits, quick amounts, demo fee) → a confirmation step showing recipient, card, fee, crediting and total → receipt. "Continue" only validates and opens the confirmation; the evaluation request is sent from "Перевести N ₸" (`.transfer-confirm`). Manual context switches and the sender UUID live in the collapsed "Контекст демо" block; UUIDs, latency, ML and biometrics are shown in the adjacent "Решение BCC Shield" panel. The receipt shows the authoritative approved, held, blocked or cancelled state, amount, masked recipient, short operation number (full ID in `data-transaction-id` and the side panel) and the next action. A new transfer requires its explicit button; unknown outcomes show an in-phone warning, keep the existing recovery controls and block new intents. See `docs/DESIGN_SYSTEM.md` for sources and design decisions.

Cooling is a three-stage security sheet: explanation, five explicit yes/no questions, then an editable review. Keyboard focus moves to the stage heading; native radio navigation, dialog focus trapping, Escape-to-leave-held and focus restoration remain available. The primary button cannot advance an unanswered question. Kazakh/Russian switching preserves answers. Motion is disabled when the OS requests reduced motion.

The server alone controls the 15-minute hold. Clean answers may be saved before expiry but cannot release the transfer early. Timer expiry never sends a request. Explicit confirmation after expiry still requires a server decision. Cancel stays a durable server action. The sheet refreshes details on visibility/focus and every 15 seconds. A lost mutation response is checked through GET using the same operation ID, including a committed questionnaire that remains held.

Unsent answers are retained per operation ID in a bounded in-memory parent cache (250 drafts, matching the unresolved-intent limit), so closing and reopening the sheet does not erase them. They are not written to browser storage. Reload restores only server-saved answers; the sheet states that unsent answers disappear on reload. An authoritative matching save consumes the draft; later reopening uses fresh server answers rather than a cached saved snapshot. Terminal server decisions remove their draft. Background recovery cannot replace another actively selected case with the last submitted attempt. Existing persisted recovery IDs and stale-response protections are unchanged. No raw clipboard content is collected.

Stable QA selectors: `.phone-form .transfer-cta`, `.phone-confirm .transfer-confirm`, `.transfer-edit`, `.phone-receipt[data-transaction-id]`, `.receipt-review`, `.receipt-new`, `dialog.mobile-cooling[data-step="intro|question|review"]`, `.cooling-start`, `.cooling-next`, `.cooling-back`, `.cooling-review-list`, `.cooling-edit`, `.cooling-submit`, `.sheet-close`. Radio names match the five API questionnaire keys. The labelled countdown uses `role="timer"`.

Focused regression tests in `tests/cooling-flow.test.ts` and `tests/mobile-session.test.ts` cover explicit negative answers, incomplete questionnaires, reopening drafts, operation isolation, safe field filtering, bounded retention, active-case pinning, saved-answer provenance and cancellation reconciliation. Run the full `npm run typecheck`, `npm run test`, and `npm run build` before release. Browser QA should additionally exercise clean answers through the strict hold, red flags, cancellation, response loss, reload, live language switching, keyboard-only navigation, and narrow screens against isolated test data.

## /mobile — the phone on a real smartphone

`/mobile` renders the same `App` from `shield-app.tsx` with `layout="phone"`: only the phone screen at full width, without the bezel, the fake status bar, the "Решение BCC Shield" panel, the demo presets and the SOC tab. Logic is not duplicated: recovery, the cooling sheet, drafts and ҚАЗ/РУС work exactly as on `/`. `TransferPhone` takes `bare` for this mode; styles are the `.phone-stage.is-bare` / `.mobile-shell` block at the end of `mobile-client.css` (safe areas, sticky tab bar, `interactive-widget=resizes-content` so the keyboard does not cover "Продолжить").

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

## Trusted contact in the cooling sheet (Bekzat's trusted-contacts API)

While a transfer is `cooling_off`, `trusted-circle.tsx` (rendered in `cooling-modal.tsx`, so on `/` and `/mobile`) offers «Сообщить доверенному лицу» for each verified contact with notifications enabled, then shows the status from `ui_texts.json`: в очереди → сервис принял → получение подтверждено / контакт сообщил о подозрении (or доставка не подтверждена / срок истёк). Suspicion adds a red "do not confirm" warning; the block always states that the contact cannot approve or release the transfer. The contact is connected and consents in the Telegram bot; setup is not part of the phone UI.

The browser only calls `GET|POST /api/v1/trusted-circle/{transaction_id}` through the existing `api<T>`. That Next.js route (`src/app/api/v1/trusted-circle/[transactionId]/route.ts`) is the only place that talks to the integration API:

- the owner is the transaction's sender from the server-side SOC record, not a value sent by the browser;
- it mints a 5-minute owner capability with `BCC_INTEGRATIONS_SIGNING_KEY` (same key and format as `scripts.integration_token`); the key and capability never reach the bundle, storage or the page;
- responses are reduced to contact id/alias and notification id/state/expiry; correlation IDs, error codes and chat addresses are dropped;
- it is off (404 → the block is hidden) in the pilot, in the in-process demo mode, without the signing key, and when the backend has integrations disabled or lacks the routes.

Polling: one owner (this component), every 4 s while a notification is queued or sent, only while the sheet is open and the page visible; it stops at a terminal state and pauses 15 s on 429. That is above the 2.1 s floor and inside the 30/min per-owner budget.

To enable on the demo laptop (after Bekzat's backend is in `main`): run the backend with `BCC_INTEGRATIONS_ENABLED=true` and a signing key of at least 32 characters, and start the frontend with the same `BCC_INTEGRATIONS_SIGNING_KEY` and `BCC_API_MODE=live`.

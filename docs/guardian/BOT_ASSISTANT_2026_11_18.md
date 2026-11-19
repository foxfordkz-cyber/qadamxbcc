# Guardian assistant — recipient usability release

Implemented/live-tested 18 November; report finalized 19 November 2026.
Branch: `feature/bekzat-bot-assistant`, based on the independently
verified `codex/bekzat-main-readiness-20261118` preparation. This is a separate product
change requested after integration preparation, not part of the team's gated main merge.
The original top integration branch, main and other participants' frontend are unchanged.

## What is usable

The existing aiogram bot now exposes twelve private-chat commands, in Russian and Kazakh:

| Command | Result |
|---|---|
| `/menu` | Main menu with direct entry to reports, history and privacy |
| `/status` | Actual active consents, enabled notifications, outstanding acknowledgements, suspicion and report counts |
| `/notifications` | Five notifications per page; open a saved status and its UTC timestamps |
| `/contacts` | Existing recipient consents and confirmed revocation, without typing a UUID |
| `/check` | Existing five-question educational check, with cancellation and replay protection |
| `/report` | Choose a verified consent, category and description; preview and explicitly submit to demo SOC |
| `/reports` | Five current receipts per page, each with a button to open and refresh its status |
| `/safety` | Short educational action plan; no automatic bank decisions |
| `/privacy` | Data, draft lifetime, consent and revocation explanation |
| `/language` | RU/KK selection |
| `/cancel` | Discard current questionnaire/report draft, preserving language, existing consents and submitted records |
| `/help` | Invitation, consent, revocation and scope help |

`/start` and existing invitation/revoke commands remain compatible. Command metadata is
registered once after the same-host polling lock is acquired, for private chats and
default/RU/KK locales. A bounded registration failure logs only a static code; inline
navigation and typed commands remain usable without automatic registration retries.
See the official [Telegram command API](https://core.telegram.org/bots/api#setmycommands).

## Fixed interaction errors

- The previous generic `r:submit` button could act on a newer draft. Each preview now
  has a fresh confirmation nonce. Category buttons belong to their draft; changing
  category invalidates its previous preview. Expired, cancelled and replayed submissions
  cannot create another report. Existing service idempotency still applies.
- Report history previously displayed identifiers without buttons to open the receipts.
  It now has bounded pagination and direct recipient-authorized status navigation.
- Unsupported commands/text/media receive a helpful menu response. Input is not echoed,
  stored, forwarded or downloaded. Free text is accepted only inside an explicit report
  draft and still passes existing secret/content validation before preview.
- Navigation out of a draft clears its pending text/confirmation. `/cancel` does not
  silently revoke consent or delete an already submitted report.
- Invitation arguments accept normal command whitespace, including tabs; they remain
  distinct from the no-argument onboarding menu.
- Real acceptance exposed a missing transition after consent: the old consent buttons
  stayed on screen. Successful consent now edits that same message into the main menu,
  preserving the chosen language or using the invitation language for first-time onboarding.
  Revocation offers a return-to-menu button. No extra send is added. The user confirmed
  automatic menu opening on the updated live runtime; both initial locales have regressions.

## Boundaries and limitations

All new entry points use the existing private-chat, sender identity, allowlist and Redis
quota checks. The real polling router itself is testable via aiogram Dispatcher; the
Telegram HTTP transport is replaced in offline tests. Redis admission failure fails closed
and does not log the raw update or exception. No owner or SOC role is inferred from Telegram.

Notification and report reads join the currently verified, consenting recipient on each
request. No owner identity, banking fields, chat ID, delivery message ID, token, retry
internals or arbitrary report description is exposed in the notification center.
Expired reports and owner-only reports are excluded. Revocation makes earlier receipt
and notification links inaccessible. Counts are saved facts, not a risk score.

Notification/report pages are bounded to the latest 100 records, five per page, with
stable timestamp/UUID ordering. Read-only offset pagination can shift when new records
arrive; Refresh starts from current saved facts. The complete operator audit remains in
the existing protected API. Existing consent selection shows at most ten current consent
links across owners; each owner retains the separately authorized three-contact limit.

Notification detail is read-only. ACK/suspicion still use the original delivered message
and its existing binding/consent/deadline checks; opening history cannot approve a transfer.
Telegram API acceptance is not called proof of reading. A failed/ambiguous menu edit never
falls back to sending another message. No broadcast, auto-submit, new provider, bank API,
scoring change, frontend change, schema migration or new HTTP endpoint was introduced.

Language remains in the existing 15-minute Redis conversation data. It is not a permanent
profile preference. Drafts expire; this release does not turn the demo into bank IAM or
provide production retention/durability guarantees.

## Verification

`tests/integrations/test_bot_assistant.py` adds 24 cases using the same polling router,
real SQL lifecycle and controlled Telegram transport: both languages/all commands,
invitation/consent/revoke, pagination, identity/consent isolation, stale and expired previews,
duplicate submission, cancellation, unsupported input, Redis admission/quota failure,
localized private command registration and no resend after failed/ambiguous edits.
The earlier Guardian navigation/report tests remain and follow the actual emitted buttons.

Focused offline acceptance after the live-found fix: **33 passed** (24 new + 9 existing),
including both languages and automatic post-consent navigation.
Ruff/format: **159 files PASS**; strict mypy: **158 source files PASS**.

Full release results and CI links are recorded in the PR after execution. Earlier preparation
counts (423 backend cases) describe the base, not this release. No live acceptance of these
new screens is claimed by offline or Docker tests.

Reproduce without real secrets from `backend/`:

```sh
uv run pytest tests/integrations/test_bot_assistant.py tests/integrations/test_guardian_navigation.py tests/integrations/test_guardian_bot_reports.py
uv run ruff check .
uv run mypy
```

Full checks: `bash verify.sh`; CI also runs real PostgreSQL/Redis, both migration upgrade
paths, six synthetic Docker flows and the unchanged frontend browser harness.

## Live acceptance and team handoff

The owner gave a **new** grant on 18 November: at most 12 bot replies, 30 menu updates,
30 minutes, one already verified private chat. The encrypted configuration/ACL was
validated without new token entry. The notification worker stayed **off**. This was
independent of the closed 14 November RU/KK Cooling-Off delivery session.

Observed: **9 sendMessage attempts, all 9 accepted by Telegram; 22 menu-update attempts,
20 confirmed accepted**. Two menu attempts have no confirmed-success ledger entry and
are not called successful. The counters include the technical restart for the onboarding
fix; its original deadline, recipient and budgets were retained. No ambiguous send was
retried. The user confirmed the actual consent/menu screens and report receipt.

Real callbacks exercised KK selection, factual dashboard, privacy, the questionnaire,
cancellation and stale-step rejection. A real explicit report submission created exactly
one synthetic report. Fresh SOC GET and acknowledgment both succeeded; the bot showed
the updated demo-operator status. `/reports` and `/notifications` worked; notifications
were correctly empty. The report remained present across the polling restart. Final
confirmation verified automatic menu opening after consent in the updated runtime.

At closure, the local acceptance recorder reported a Windows `PermissionError` while
replacing a status file. The exact OS cause was not retained, so it is not claimed certain;
temporary reader/replace contention is a plausible cause reproduced by a synthetic lock
test. The local recorder now retries only file replacement for at most 0.5 seconds and
fails closed if access remains unavailable. The lock test and budget/expiry tests passed
without network requests. ACLs were not weakened, and no Telegram request is retried.
Closure was independently verified: grant inactive, polling stopped, consent revoked,
worker never started. The two dedicated PostgreSQL/Redis test containers were stopped.

No new Cooling-Off alert, real outage/429 test, bank operation or production deployment
occurred in this navigation session. Those are not inferred from menu acceptance.
The earlier delivery evidence remains historical. See
[sanitized live evidence](evidence/bot-assistant-live-2026-11-18.json) and
[Telegram acceptance addendum](../integrations/TELEGRAM_LIVE_ACCEPTANCE.md).
Any later live run needs its own scoped grant; this completed grant cannot be reused.

Frontend integration uses the same published 41-path contract and existing examples.
Main integration still waits for redesign and Tanirbergen recovery before the top Bekzat
branch is retargeted. Review this bot change separately against its preparation base;
do not merge main or squash/rewrite existing contributors' history without owner agreement.

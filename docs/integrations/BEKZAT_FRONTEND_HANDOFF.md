# Bekzat — frontend integration handoff (2026-11-14)

Scope: additive APIs from [PR #1](https://github.com/foxfordkz-cyber/qadamxbcc/pull/1),
[PR #2](https://github.com/foxfordkz-cyber/qadamxbcc/pull/2) and
[PR #3](https://github.com/foxfordkz-cyber/qadamxbcc/pull/3), plus additive [PR #4](https://github.com/foxfordkz-cyber/qadamxbcc/pull/4). Current core baseline a02d20d.
Existing frontend/core contracts are preserved. No frontend files were changed.

Durable retry update: notification responses include `attempts` and `next_attempt_at`.
Explicit Telegram rejection schedules at most three attempts across restarts. A queued
notification with `telegram_rate_limited` is waiting until its persisted due time.
Consent, core state and expiry are rechecked; ambiguous delivery is never resent.
Implementation: `04392a8` in PR #1, inherited by this stack. Authorized real acceptance is recorded in TELEGRAM_LIVE_ACCEPTANCE.md.

## Contract package

- [openapi.json](openapi.json): complete generated FastAPI OpenAPI, including enums, UUID/date-time constraints and request/response components.
- [api_examples.json](api_examples.json): one request/response example for every new operation, role, headers and success status; all 15 are validated against actual route models in CI.
- [ui_texts.json](ui_texts.json): RU/KK labels for contact, notification, run, gateway, marker and error states. `kk` is the ISO language code used by the project.

Examples are synthetic static illustrations. Header placeholders and the invitation
example are deliberately invalid credentials. Dates are illustrative, not fresh evidence.
Use IDs returned by the live API; do not hardcode example IDs/message IDs. The simulator
example is operator-only; the actual Telegram ingress receives private authenticated
updates from polling. Only fake-mode operators derive the deterministic fake message ID.

| Method and full path | Role | Success | Idempotency-Key |
|---|---|---:|---|
| POST `/api/v1/trusted-contacts` | owner | 201 | — |
| GET `/api/v1/trusted-contacts` | owner | 200 | — |
| DELETE `/api/v1/trusted-contacts/{contact_id}` | owner | 200 | — |
| POST `/api/v1/trusted-contacts/transactions/{transaction_id}/notifications` | owner | 200 | — |
| GET `/api/v1/trusted-contacts/transactions/{transaction_id}/notifications` | owner | 200 | — |
| GET `/api/v1/trusted-contacts/notifications/{notification_id}/history` | owner | 200 | — |
| POST `/api/v1/trusted-contacts/simulator/update` | simulator | 200 | — |
| POST `/api/v1/external-checks` | owner | 200 | UUID |
| GET `/api/v1/external-checks/{check_id}` | owner or soc | 200 | — |
| POST `/api/v1/integrations/transactions/{transaction_id}` | owner | 202 | UUID |
| GET `/api/v1/integrations/transactions/{transaction_id}` | owner | 200 | — |
| GET `/api/v1/integrations/soc/transactions/{transaction_id}` | soc | 200 | — |
| GET `/api/v1/integrations/health` | soc | 200 | — |
| GET `/api/v1/integrations/soc/transactions/{transaction_id}/timeline` | soc | 200 | — |
| GET `/api/v1/integrations/health/details` | soc | 200 | — |

## Authorization and request rules

An operator runs `uv run python -m scripts.integration_token --help` to provision a
short-lived demo capability. It binds role and owner UUID; passing an account ID alone
is not authorization. Default TTL is 15 minutes, maximum one hour. Production bank
session/IAM provisioning remains a separate integration dependency. Do not embed
operator, SOC or simulator capabilities/signing keys into the frontend bundle.
Keep invitations and capabilities out of analytics, browser logs and persistent storage.
POST invitation uses explicit `owner_consent:true`, language `ru` or `kk`, and returns
`Cache-Control:no-store`. Recipient consent remains a separate step; binding is not consent.

For gateway/orchestration POST, generate one UUID Idempotency-Key for a user intent and
reuse it when retrying the same payload. Different payload under the same key is 409.
Notifications deduplicate by contact+transaction without an extra header. Orchestration
also has one canonical run per transaction. Its optional contact_id/gateway_identifier
requires at least one requested integration. All owner resources are account scoped.

## Integration flow and states

1. Call the existing transfer evaluate API and keep its returned transaction_id/status.
2. Offer contact notification only for `cooling_off`, with owner+recipient consent.
3. POST the separate integration intent after the core transaction has committed.
4. Poll the run or notification at >=2.1-second intervals; handle Retry-After on 429.
   Multiple widgets share the default 30/minute capability budget: use one polling owner.
5. SOC combines its existing feed/reasons/graph with the separate advisory evidence view.

Contact: NOT_CONFIGURED → PENDING_CONSENT → VERIFIED → REVOKED (with CONTACT_ prefixes).
Binding consumes the one-use invitation but leaves PENDING until independent consent.
Either participant can revoke. Owner DELETE is idempotent; after address erasure a
repeated contact callback is rejected, without restoring consent.

Notification: NOTIFICATION_QUEUED → NOTIFICATION_SENT → CONTACT_ACKNOWLEDGED or
SUSPICION_REPORTED. ACK cannot erase suspicion. Terminal alternatives: DELIVERY_FAILED,
CONTACT_REVOKED, NOTIFICATION_EXPIRED. `expires_at` is the existing core cooling deadline.
Do not erase a historical suspicion when it expires; disable further actions instead.
SENT means provider accepted, not read. A contact has no power to approve/release funds.
Explicit rejected-send retry emits NOTIFICATION_RETRY without creating a second alert.
Ambiguous sends/timeouts are not automatically repeated.

Run: QUEUED → RUNNING → COMPLETE / DEGRADED / FAILED. COMPLETE means orchestration
finished, not notification delivered or payment approved. `contact_outcome` is the
processing snapshot: read notifications for later delivery/callback changes. A recovered
run clears its current error_code; prior attempts remain in events. Attempts are bounded.
The intent row and audit form the durable outbox in one DB commit. This is an optional
post-evaluation request, not automatic capture of every core transaction.

Gateway: show `source:MOCK`, `fresh`, `result.status`, timestamps and bilingual
description_ru/description_kk. CLEAR is not payment approval; INDICATORS is not a
finding about a real customer. UNKNOWN/UNAVAILABLE are explicitly inconclusive.
`verified` refers only to the synthetic contract, never an official NBK signature.
Use a new idempotency key for an intentionally new check after old evidence expires.

SOC EnrichmentOut includes transaction_id, unchanged core_status, nullable run,
notifications, external_checks, sanitized events, source and advisory_only. Join
existing core reasons/graph by transaction_id; the enrichment does not duplicate core
explanations. View bounds: 100 checks, 300 events; pending standalone checks can be
absent until completion. Empty arrays are valid. Telegram chat address never appears.

## Errors and UI actions

Domain errors: `{"detail":"stable_error_code"}`; validation: standard FastAPI
422 detail array. Capability/dependency errors also use a string detail. Do not
translate raw provider diagnostics or expose internal responses to end users.

| HTTP | Meaning / client action |
|---|---|
| 401 | Missing/invalid/expired capability; obtain a new authorized demo session |
| 403 | Wrong role/callback identity; stop retrying; do not escalate privileges |
| 404 | Missing or foreign resource, or disabled simulator; show unavailable |
| 409 | Consent/cooling/invitation state or idempotency conflict; reload state |
| 422 | Invalid UUID, fields, language, identifier, consent or body; fix input |
| 429 | Respect Retry-After and shared per-principal budget |
| 503 | Disabled integrations or unavailable rate limiter; show safe degraded state |

Special 409: external_check_in_progress → retry same key later;
idempotency_key_payload_conflict / integration_payload_conflict → preserve intent and
inspect payload, never silently regenerate keys. contact_consent_required → consent
flow; active_cooling_required → no alert; invalid_expired_or_used_invitation → new
invitation if the owner still consents. Domain errors never authorize a payment.

## Team acceptance

Damir/mobile: implement optional setup/consent/notification UI using the contract;
SOC owner: render advisory evidence and bilingual descriptions beside existing reasons.
The contract package has executable validation, but no joint browser acceptance or
human core-owner approval has occurred. These remain explicit team dependencies.
See [demo guide](BEKZAT_DEMO_GUIDE.md), [verification](BEKZAT_FINAL_VERIFICATION.md)
and [readiness matrix](BEKZAT_90_PERCENT_AUDIT.md) for evidence and limits.

## Timeline and Health presentation

Timeline returns `transaction_id`, `as_of`, `events`, `next_cursor`, `advisory_only`.
Render each event's timestamp/category/importance and description_ru/description_kk;
importance is a static presentation label, not a new risk score. Preserve opaque cursor
verbatim, page size 1–100 (default 50), continue until null. Cursor expires after 15min
and binds transaction: on 422 discard cursor and reload the first page. Core facts have
null correlation and source persisted_core; audit rows retain their actual correlation.
Do not invent intermediate core decisions. Detailed projection/consistency rules are
in [INCIDENT_TIMELINE_SPEC.md](INCIDENT_TIMELINE_SPEC.md).

Health details returns `status`, `checked_at`, DB/Redis/worker states, configured
Telegram/gateway modes, queue counts, nullable last_successful_processing. Poll no
faster than 5s and share polling between widgets. queue=null means unknown, not empty.
telegram=test_enabled does not prove Telegram availability. gateway=mock_ready means
the in-process MOCK is enabled. Healthy/degraded responses remain HTTP 200; expired
auth is 401, wrong role 403. Only this diagnostic API uses a bounded process-local
SOC budget during Redis failure; other protected APIs retain Redis fail-closed rules.
See [INTEGRATION_HEALTH_REPORT.md](INTEGRATION_HEALTH_REPORT.md) for definitions.

Notification `attempts` counts reserved delivery claims, an upper bound on network
attempts (expiry may prevent I/O); pre-migration historical rows default to zero.
`next_attempt_at` is a server schedule, never an instruction to call send again.
Do not retry DELIVERY_FAILED after ambiguous send. A scheduled rejection retry is
still NOTIFICATION_QUEUED; show its due time and preserve the same notification ID.

## Optional educational Scam Safety mapping

Reuse the existing CoolingQuestionnaire fields; no new endpoint, blocker or automatic
banking decision is introduced. An educational screen alone must not submit resolve-cooling.
Existing explicit core resolution remains subject to its own contract and user intent.

| Existing field | RU prompt | KK prompt |
|---|---|---|
| caller_claims_bank_or_police | Звонящий представился сотрудником банка или полиции? | Қоңырау шалушы өзін банк немесе полиция қызметкері деп таныстырды ма? |
| asked_to_move_to_safe_account | Вас просили перевести деньги на «безопасный счёт»? | Ақшаны «қауіпсіз шотқа» аударуды сұрады ма? |
| asked_to_keep_secret_or_install_app | Вас просили скрыть перевод или установить приложение удалённого доступа? | Аударымды құпия ұстауды немесе қашықтан қол жеткізу қолданбасын орнатуды сұрады ма? |
| initiated_by_customer | Вы сами решили сделать этот перевод? | Бұл аударымды өзіңіз жасауды шештіңіз бе? |
| knows_recipient_personally | Вы лично знаете получателя? | Алушыны жеке танисыз ба? |

This is handoff copy for existing fields, not a second implemented questionnaire or
completed frontend feature. Trusted Circle is deferred; do not fan out invitations or
silently increase the single-active-contact quota.

# Guardian 3 operations and consent privacy

This workstream depends on case PR #8 for the combined release, but operates on existing
notification/consent tables. No new migration or financial path change. No live Telegram test.

## Read-only diagnostics

New SOC GET APIs under `/api/v1/integrations/soc/operations`:

| Path | Response | Operator action |
|---|---|---|
| /queue | QueueSummary | grouped states, processing count, oldest queued/processing age, terminal failures |
| /notifications | JobPage | inspect jobs; `failed_only=true` shows terminal failure queue |

Use the existing `/integrations/health/details` for five-second cached database/Redis status,
worker heartbeat, last success, enabled adapter and mock gateway readiness. It never probes
Telegram. Job inspections use normal Redis-backed authenticated rate limiting and fail closed
while Redis is down; the narrow existing health endpoint remains usable with its local budget.
Poll diagnostics no faster than once per five seconds, stop polling hidden views.

Page parameters: limit 1–100 and next_after_id UUID. Jobs and permission exports are ordered by
UUID for stable keyset traversal, not priority. Permission history is chronological with UUID
tie-breaking. New rows can appear between requests; this is not a frozen export snapshot.
All pages remain authorization-scoped. Missing/foreign permission-history anchor returns
400 permission_cursor_invalid. State counts include all retained synthetic jobs.

Processing age exists only for queued claimed jobs; queue_age_seconds is elapsed time since
job creation (including terminal jobs), not measured end-to-end delivery time.
Dispositions distinguish queued, delayed, processing, ambiguous, retry_exhausted and terminal.
`retry_scheduled` describes the persisted explicit-provider-rejection schedule only; every
actual attempt still rechecks live consent, preferences, cooling state and expiry under locks.
It never means a guaranteed future message. `manual_resend_supported=false` always.

The existing durable `DELIVERY_FAILED` state is the dead-letter state; retry_exhausted and
delivery_uncertain reasons remain persisted with the existing audit. No second queue or fake
recovery action is added. An abandoned claim older than 30 seconds becomes uncertain, never
resent. At most three attempts for an explicit rejection, no late send after the eligibility
check, no automatic retry after timeout/ambiguous outcome. A provider request already in flight
cannot be recalled; revoke is serialized on the same contact lock, so no new send starts after
revocation commits. Cooling expiry cannot cancel a provider request already in flight either.

## Polling ownership and recovery

Before calling aiogram start_polling, a same-host OS file lock is acquired for the parsed bot ID.
Only a one-byte marker and hashed public bot identifier are stored under the local temp directory;
never the token, chat ID or update. Kernel descriptor release handles normal exit and process
death; lock files are intentionally not unlinked to avoid an inode replacement race. Failure to
acquire the lock fails closed. Tests run fake requests only, including a child-process crash.
Some local Windows runs deny creating the test child with WinError 5 before its code executes.
Only that specific Windows process-creation error is recorded as an explicit skip; ACLs/security
are unchanged. Linux CI must execute the crash test. A local skip is not crash-recovery evidence.

This is a local single-host safeguard, not a distributed leader election mechanism. Do not run
multiple polling hosts/containers for one bot. Cross-host orchestration must enforce one replica
before any production use. Redis FSM has a 900s TTL and survives polling-process recreation,
but the inherited demo Redis has persistence disabled: a Redis-server restart loses drafts and
requires restarting the UI flow. Consent, submitted reports/cases and notification decisions
remain in PostgreSQL. Nothing resubmits automatically when ephemeral draft data is lost.

## Consent privacy center

New owner GET APIs under `/api/v1/integrations`:

| Path | Response | UI action |
|---|---|---|
| /privacy/permissions | PermissionPage | own permission export: consent timestamps, current validity, language/preferences |
| /privacy/contacts/{contact_id}/history | PermissionHistory | existing consent/prefs/revoke events, no duplicated audit |

Reuse GET /trusted-contacts, PATCH /trusted-contacts/{id}/preferences and DELETE /trusted-contacts/{id}.
DELETE is safe personal-field erasure plus revoke: clears alias, invitation hash and chat ID,
disables notifications and invalidates queued sends. It is not deletion of financial/audit history.
Exports omit aliases and identifiers of delivery, tokens, owner IDs and banking details.
Last consent remains visible as historical fact after revoke, while currently_valid is false.
Three active contacts and exactly one selected recipient per notification remain unchanged.

Retention is explicit: active contact personal fields remain until revoke; minimal contact and
integration audit metadata remain until the disposable demo database is removed by its operator.
The API returns this actual policy rather than promising a 30-day purge that is not implemented
for legacy contact tables. Case content has its separate seven-/thirty-day policy. Production
requires an owner-approved lawful retention/backup policy; no production readiness is claimed.

## Contract, errors and acceptance

Regenerate canonical OpenAPI/examples with `uv run python -m scripts.export_operations_contracts`.
Use the existing frontend transport, headers and error rules from FRONTEND_HANDOFF.md. 401/403
means authentication/role failure; 404 hides foreign contacts; 400 invalid history anchor; 422
invalid query; 429 respects Retry-After; 503 disabled integration/Redis limiter unavailable.
All four responses use Cache-Control: no-store. No mutation retry or send action exists here.

Regression suite covers terminal inspection, delayed/uncertain claims, owner boundaries,
pagination, revoke/erasure, local polling lock exclusion and crash release. PostgreSQL covers
delivery/revoke serialization with competing workers; existing suites retain 429, Retry-After,
unknown outcome, expiry, duplicate callbacks, connection recovery and FSM TTL checks.
Local Docker recovery evidence is tracked separately in the release report, not inferred from
mock reconnect tests. Live provider results are explicitly outside this release's acceptance.

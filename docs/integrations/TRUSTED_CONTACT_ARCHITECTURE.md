# Telegram trusted contacts — advisory only

Owner: Bekzat, Integrations & External APIs. Initial audit: `627fa88`;
current compatible core baseline: `a02d20d` (Damir's hybrid ML work preserved).

## Durable retry update (2026-11-14)

Only an explicit Telegram flood-control rejection may schedule a retry. The queue
persists attempts and next_attempt_at, releases its claim/locks, and a future worker
rechecks recipient consent, core cooling status and expiry before sending. Maximum
three provider attempts total, including the first. Delays are never slept through
while holding a database lock. A delay reaching the cooling deadline expires the
notification. Timeout, transport failure, 5xx or a crash with an outstanding claim
remain terminal/uncertain and are never resent automatically.

Migration 0002a_notification_retry extends 0002 without rewriting it. Downstream
gateway/orchestration branches add merge revisions, so an already-applied 0004 can
upgrade safely as well as a fresh database. Stop old workers before upgrading:
they do not understand next_attempt_at. Rollback also requires stopping workers
and resolving scheduled jobs before dropping scheduling columns.

Evidence: test_durable_retry.py, PostgreSQL concurrent retry test, existing timeout/
crash/deduplication tests and migration parity. Before this change a 120-second
explicit rejection reproduced DELIVERY_FAILED instead of a durable queued retry.
This section supersedes the earlier short-delay policy described below.

The existing `TransferService`, scoring weights, 15-minute cooling deadline and
`resolve-cooling` are unchanged. No integration can approve or block funds.

## Consent and delivery

An operator provisions a short-lived owner capability for a synthetic account.
`POST /trusted-contacts` requires explicit owner consent and returns a 256-bit,
single-use invitation. Only its SHA-256 digest is stored. An authenticated private
Telegram sender consumes the invitation and separately clicks consent. Knowing an
account UUID or Telegram ID is insufficient. The fake ingress requires a separate
simulator role; owner credentials cannot call it. Share invitations privately.

Both consents are required before an owner can queue an alert for their own active
cooling transaction. The database enforces one notification per contact/transaction;
PostgreSQL row locks serialize competing enqueue, revoke and consent requests.
The invitation quota guard uses PostgreSQL FOR NO KEY UPDATE so core foreign-key
checks are not blocked; SQLAlchemy maps this via
[`with_for_update(key_share=True)`](https://docs.sqlalchemy.org/en/20/core/selectable.html#sqlalchemy.sql.expression.GenerativeSelect.with_for_update).
The worker runs separately; no Telegram network I/O occurs in scoring or enqueue.
Notification expiry uses the existing transaction's `cooling_until`, never a new timer.

| State | Meaning and permitted transition |
|---|---|
| CONTACT_NOT_CONFIGURED | Owner has no non-revoked contacts; invite creates PENDING |
| CONTACT_PENDING_CONSENT | Owner agreed; contact has not agreed; no alerts |
| CONTACT_VERIFIED | Both consents recorded; owner can queue for active cooling |
| CONTACT_REVOKED | Either participant withdrew; queued alerts canceled, address erased |
| NOTIFICATION_QUEUED | Durable, unique alert waiting for worker |
| NOTIFICATION_SENT | Telegram API accepted (not proof of human delivery) |
| DELIVERY_FAILED | Provider failed or delivery uncertain; no automatic resend |
| CONTACT_ACKNOWLEDGED | Exact bound recipient acknowledged the delivered message |
| SUSPICION_REPORTED | Advisory risk signal; later ACK cannot erase it |
| NOTIFICATION_EXPIRED | Worker suppressed expired/resolved transfer alert |

Repeated consent, owner DELETE, enqueue and valid callbacks do not duplicate state.
Owner DELETE remains idempotent after revocation. Contact-side revoke erases its
delivery address, so repeating that authenticated contact callback is rejected as
not found; it never restores consent. Used/expired link tokens are rejected. Callback sender, private chat, exact message ID and notification
expiry are validated. Consent/revoke callbacks also require the bound private sender.
History preserves observed delivery/advisory states; `expires_at` governs whether
callbacks remain actionable. Expiry does not erase a previously reported suspicion.

## Crash and failure semantics

The worker commits a claim before sending. After a crash a stale claim becomes
DELIVERY_FAILED with `delivery_uncertain`; it is never automatically resent.
Telegram has no send-message idempotency key, so exactly-once delivery cannot be
promised. This conservative policy trades possible missed alerts for no blind
duplicate sends. The contact row lock serializes revocation against delivery;
revocation cannot recall a message already accepted by Telegram.

Audit rows contain resource IDs, correlation IDs, event codes and times, never
message bodies, invitation tokens, credentials, chat IDs or financial details.
The database stores the internal delivery address until revocation. Restrict DB
access and establish retention/encryption policies before any non-demo usage.

## Review boundary

Audit follow-up (2026-11-14): Telegram flood-control rejection (`retry_after`)
permits at most one retry after the specified wait (minimum 50 ms), only when the
wait is at most 1 second and within the overall adapter timeout/cooling expiry.
Long waits, repeated rejection, generic errors, timeouts and unknown delivery are
terminal. The existing durable claim remains in force; a crash never blindly resends.
`NOTIFICATION_RETRY` is audited without provider text. This policy relies only on
explicit failed responses documented in the [Telegram Bot API](https://core.telegram.org/bots/api#responseparameters).
Polling rejects malformed updates/dependency failures at a sanitized error boundary.
Regression tests use real aiogram dispatch with mocked HTTP; they do not prove live delivery.

The row refresh on consent checks and FOR NO KEY UPDATE invitation guard are now
included in PR A itself, with live PostgreSQL tests, rather than relying on PR C.

Shared changes: register isolated ORM tables; mount a new router and error handler;
add a reversible migration and compatible aiogram dependency. Existing API schemas
are unchanged. Core owner must review these hooks before merge. Production is NO-GO:
core endpoints have no bank IAM, integration capabilities are demo-only, and the
existing core workflow is a simulator. No production migration is authorized.

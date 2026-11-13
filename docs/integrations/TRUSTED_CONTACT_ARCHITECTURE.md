# Telegram trusted contacts — advisory only

Owner: Bekzat, Integrations & External APIs. Core baseline: `627fa88`.
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

Repeated consent, revoke, enqueue and callbacks are idempotent. Used/expired link
tokens are rejected. Callback sender, private chat, exact message ID and notification
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

Shared changes: register isolated ORM tables; mount a new router and error handler;
add a reversible migration and compatible aiogram dependency. Existing API schemas
are unchanged. Core owner must review these hooks before merge. Production is NO-GO:
core endpoints have no bank IAM, integration capabilities are demo-only, and the
existing core workflow is a simulator. No production migration is authorized.

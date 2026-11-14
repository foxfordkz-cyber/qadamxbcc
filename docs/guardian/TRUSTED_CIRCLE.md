# Trusted Circle

The owner explicitly approved a limit of **3 active contacts** on 2026-11-14. Baseline
code allowed 5; earlier prose saying 1 was incorrect. Existing rows are not deleted
by migration. Owners above the new limit may revoke contacts; new invitations remain
blocked until below 3. Expired pending invitations still occupy a slot until revoked.

Each invitation, recipient consent, notification and revocation is independent. Enqueue
requires exactly one contact_id; no bulk-send or fallback-to-another-recipient policy
exists. Owner consent never substitutes for recipient consent. Existing deduplication,
durable Retry-After and conservative treatment of ambiguous delivery remain in force.

PATCH `/api/v1/trusted-contacts/{contact_id}/preferences` requires an owner capability
and sends alias (0–40 characters, no controls), notifications_enabled and language ru/kk.
It is a replacement of preferences, idempotent when identical, and emits one sanitized
CONTACT_PREFERENCES_UPDATED event when changed. Foreign owners get 404, SOC gets 403;
revoked contacts cannot be re-enabled. No alias is copied into audit or Telegram text.

Opt-out blocks a new enqueue and is rechecked under the same contact lock immediately
before delivery, including after restart/retry. An already queued notification becomes
DELIVERY_FAILED / notifications_disabled without a provider call; this is a policy
suppression, not an ambiguous send. Re-enabling does not replay that terminal notification.
Revocation clears alias/address and disables notifications; historical audit remains.

Migration 0005_contact_preferences adds only two columns. Stop old workers, migrate,
then deploy updated workers before changing preferences. An old worker does not know
the new preference and must not run concurrently. Rollback requires stopped workers;
dropping preferences loses those settings. No scoring/core or frontend changes are made.

The Telegram recipient cannot become the bank-account owner by entering a chat ID.
Owner management is provided through protected APIs; the demo bot shows only its
recipient scope. Invitation creation and contact deletion are existing API operations.

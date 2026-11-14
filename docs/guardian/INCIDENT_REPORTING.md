# Safe incident reporting and SOC summary

All submissions go only to this deployment's **demo SOC**, not a bank, police, NBK or
external service. Explicit confirmation is required. Reports never authorize payments,
cancel transfers, alter core scores or create another blocking mechanism.

Categories: impersonation, safe_account, remote_access, other. A description contains
10–500 plain-text characters, with controls, links, mentions, long digit runs and common
secret labels rejected. This conservative filter cannot prove arbitrary prose contains
no personal data. The preview tells users not to submit secrets or real financial data.
Rejected input is not echoed, audited or logged by the integration.

Owner API: POST /api/v1/integrations/guardian/reports requires an owner capability,
Idempotency-Key UUID and confirmed_demo_submission=true. Optional transaction_id must
belong to that owner. Identical key/payload returns the original receipt; changed payload
or a duplicate body with a different key returns 409. A PostgreSQL account lock serializes
the quota of five accepted reports per owner in a rolling day, shared with that owner's
consenting contacts. Quota errors return 429; do not rotate keys to evade the quota.

Bot submission requires current private-chat binding and active contact consent. The
server derives the contact's owner solely for quota/audit partitioning. This does NOT
issue a bank-owner capability. Recipient reports cannot attach a bank transaction.
The bot rechecks consent before accepting text, on submission and on every receipt read.
The FSM draft expires after 15 minutes; Redis isolates bot/chat/user state. Cancel clears
the draft. Submission commits once before editing the receipt; a failed Telegram edit
does not trigger a fresh send or duplicate report.

Access: SOC can read all demo reports and acknowledge them. Owners can read only their
own **owner-authored** reports, never reports submitted by a contact. A recipient reads
its receipt only via its currently verified bot binding. Foreign ownership returns 404.
GET /reports (limit 1–100), GET /reports/{id}, POST /reports/{id}/acknowledge and
GET /reports/{id}/history complete the lifecycle. Acknowledgement is SOC-only and
idempotent. States are SUBMITTED and DEMO_ACKNOWLEDGED; neither means bank investigation.
Responses use Cache-Control: no-store. Report history contains codes/timestamps only.

Content becomes unreadable at seven days (410), even if the worker is down. The worker
erases expired descriptions and content hashes in batches of 100, at most once per
minute; physical deletion can lag during outages/backlog. Metadata rows are removed
after 30 days in bounded batches. Sanitized audit events retain no description and follow
the existing audit policy; they are deliberately not erased by content cleanup. Existing
Telegram messages/Telegram's retention are outside this database cleanup policy.

Migration 0006_guardian_reports follows 0005_contact_preferences. Stop old workers before
upgrade; start updated workers only after migrations. Downgrade deletes report records:
use only disposable synthetic data for the acceptance round trip.

GET /api/v1/integrations/soc/transactions/{id}/summary is SOC-only. It composes the core
decision, cooling expiry, relevant current consents, last 100 notifications, last ten mock
checks, last ten persisted events and cached integration health. Manual-review reason
codes reflect saved facts (core blocked, contact suspicion, failed delivery, degraded
integration). Presence of suspicion/failure is checked across all notifications, not only
the returned window. No numeric risk estimate or AI inference is invented. Use paginated
Timeline for a longer history. Owner-authored transaction-linked reports enter that
timeline; recipient reports have a separate report history and no banking link.

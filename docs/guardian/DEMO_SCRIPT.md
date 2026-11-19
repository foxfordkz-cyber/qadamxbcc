# Reproducible Guardian demonstration

Use a disposable, freshly seeded local Compose stack with integrations enabled and
TELEGRAM_MODE=fake. Supply the signing key through local environment configuration,
never in a URL, screenshot or report. Start backend, PostgreSQL, Redis and the integration
worker. Run `python -m scripts.seed_bcc` once, restart backend to reload the graph, then
run `python -m scripts.demo_guardian` from backend with the same local signing key.
The script refuses non-localhost and non-fake targets. Re-running on the same seed can
change velocity/history or hit report dedup; create a separate disposable demo project.

1. **A — approved:** normal preset passes core evaluation; no contact notification or
   automatic enrichment is created. Verify the SOC core decision.
2. **B — social engineering:** fake invitation → separate contact consent → synthetic
   COOLING_OFF → select exactly one contact → durable queue → fake provider acceptance
   → suspicion callback → persisted SOC advisory. Core remains COOLING_OFF. Contact is
   revoked at the end. The existing network preset also checks mock evidence and the
   blocked decision without contacting NBK.
3. **C — educational check and report:** automated RU/KK dispatcher tests navigate all
   five existing questionnaire fields, prepare a draft, select a verified consent,
   choose a category, reject secret-like input, preview, explicitly submit, read receipt,
   acknowledge from demo SOC, and verify foreign/revoked access is denied. This is Fake
   Adapter evidence, not live Telegram. The Compose script separately exercises the
   owner-demo HTTP report, idempotent replay, SOC acknowledgement and two audit events.

For UI walkthrough after separately authorized live setup: /start → choose RU/KK →
Scam Check → five answers → draft → demo SOC report → category → synthetic description
→ explicit Send. Cancel leaves no report. Notifications distinguish Telegram acceptance
from the recipient's explicit ACK; suspicion is advisory only. Consent revoke uses a
confirmation screen. Never use real bank details, secrets or real customer data.

Frontend review: consume typed examples/OpenAPI, show quota/expiry/unavailable states,
provide explicit single-contact selection, and verify keyboard/locale accessibility.
Bank-account invitation management must remain behind the application's owner session.

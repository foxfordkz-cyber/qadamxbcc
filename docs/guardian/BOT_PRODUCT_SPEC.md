# BCC Shield Guardian — implementation audit

Baseline: PR #4 7f47709, dependent on Draft #1 → #2 → #3. Main remains a02d20d.
Baseline CI 43567054363 passed: 199 unique backend cases and 12 frontend cases.
This is a demonstration assistant, not an official bank service. No bank-owner identity
is inferred from Telegram identity. Existing invitations and financial logic are preserved.

| Feature | Already implemented | Missing at baseline | Improvement / scope | Priority | Tests |
|---|---|---|---|---|---|
| Telegram ingress | Private allowlist, rate limit, consent callbacks | Menu/onboarding | Guardian router, inline menu, explicit disclaimer | P0 | test_guardian_navigation_and_survey; ingress_boundary |
| Scam check | Core CoolingQuestionnaire | Educational bot flow | Same five fields, no score or resolve call | P0 | Core field parity; RU/KK flow and stale replay |
| Recipient center | Persisted contacts/notifications | Safe navigation | Consent-filtered recipient view, no owner privileges | P1 | recipient_view_rechecks_consent_and_identity |
| Trusted Circle | Multiple independent contacts, cap **5** | Alias/preferences | User agreed cap **3**; separate implementation follows | P1 | Existing concurrency/consent tests; new tests required |
| Incident reports | Advisory suspicion callback | General report lifecycle | Separate owned, bounded report workflow required | P1 | Pending implementation |
| SOC summary | Timeline, Health, enrichment | Combined deterministic summary | Read-only composition required | P1 | Pending implementation |
| Notifications | Durable retry/expiry/dedup, ACK/suspicion | Improved presentation | Explicit provider-accepted vs acknowledged labels | P1 | Existing delivery regressions; navigation tests |
| Worker | Durable independent worker | Polling overhead investigation | Compare same workload before/after changes | P1 | Pending measured experiment |

Correction to earlier prose: service.invite already allowed five active contacts, not
one. The actual code is the baseline. Lowering to three must not delete existing contacts.
Consent is independent per contact; selecting one target never authorizes a broadcast.

This document is an implementation audit, not a declaration that all Pro 2.0 gates passed.
Live Telegram authorization from the previous stage is closed; all new tests use fake HTTP.

P2 education is deferred until P0/P1 are verified. No new external AI/provider dependency,
bank API, frontend rewrite, production deployment, force push or merge is authorized here.

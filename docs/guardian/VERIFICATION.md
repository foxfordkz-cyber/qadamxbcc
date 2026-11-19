# Guardian verification record

Verification runs: 2026-11-14; handoff completed 2026-11-15. Baseline #4 (7f47709): 199 unique backend cases and 12 frontend cases.
New chain: #5 Guardian UX → #6 approved three-contact Circle → #7 demo reports/SOC.
They depend on #1–4; all remain Draft and main is unchanged.

## Executed gates

| Gate | Result |
|---|---|
| Portable full backend | 224 passed, 10 PostgreSQL/Redis-only skips |
| Full real PostgreSQL/Redis integration suite | 186 passed, no skips |
| Unique backend total (union, not sum of repeated runs) | **234**, including 48 core and 186 integration; +35 versus baseline |
| Existing frontend tests | **12 passed**, TypeScript and production build passed |
| Full verify.sh | ALL GREEN: lint, formatting, strict mypy (113 sources), pytest, frontend, Compose config |
| Migration | SQLite round trip/ORM parity; PostgreSQL old-stack → 0006 → core 0001 → 0006, no drift |
| Docker | Five healthy fake/test services; normal/scam/network/incident demos pass |
| Recovery | Actual Redis and PostgreSQL stop/start; worker stop past heartbeat TTL then restart; advisory/report persisted, no duplicate alert |
| Contracts | 22 JSON examples + exact OpenAPI export parity |
| Local new Telegram | Fake HTTP only; no token configured, allowlist empty; no real sends |

Source implementation 14831db44d5e1e70e7a5c9cabef1281c7d59507e passed
[CI 43596133203](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/43596133203):
full verify, 186 PostgreSQL/Redis cases and Docker fake E2E. #5 CI 43569413419 and #6
CI 43571963009 passed at their respective heads. Follow-up documentation/startup-grace
commit has its own current checks on [PR #7](https://github.com/foxfordkz-cyber/qadamxbcc/pull/7);
the final release manifest records that exact head/run after completion.

Observed issues were resolved rather than hidden: Circle error precedence for revoked
consent; report cancellation retaining a text handler; stale revoke navigation error;
worker file encoding/line endings during editing; demo script state-field naming; and
insufficient worker startup grace under local memory pressure. A trial execution of the
developer demo inside the minimal runtime image lacked dev-only httpx; the documented
host development environment ran it successfully, as did CI. No unnecessary runtime
dependency was added. A local recovery run ended with HTTP ReadTimeout before a session interruption; Docker was unavailable on resumption; its log is retained. A second cold-start attempt timed out before fault injection; the warmed repeat returned initial health in 192ms and recovery was rerun on the same test stack. Failed attempts remain in the local evidence archive.

See PERFORMANCE.md for separate p50/p95/p99/error scopes, controlled pacing comparison
and cold-start limitations. No performance gain is claimed for the unchanged core engine.
New reports and summary endpoints remain off the critical scoring path.

## Acceptance boundaries

Local synthetic hackathon demo: **GO** with freshly seeded fixtures and a healthy stack.
Feature/test team integration: **GO for wiring/review** using the published contracts.
Main merge/shared migrations and completed team acceptance: **pending core-owner review
and joint frontend sign-off**. The handoff is published; receipt/review by teammates is
not assumed. Production: **NO-GO** (bank IAM, production operations/security acceptance
and official bank integration are outside this demonstration). Inherited demo PostgreSQL uses synchronous_commit=off and Redis is volatile. Worker/process restart recovery is tested; host power-loss durability and Redis-server persistence of FSM drafts are not claimed.

New Guardian live Telegram acceptance: **NOT RUN**. Previous authorized acceptance
belongs to the previous implementation; its send grant remains closed. Original 100-item
integration matrix remains historical 99.50% (98 DONE, 2 external BLOCKED); this is not
a new numerical score for Guardian 2.0 and not a claim of 100% acceptance.

All eight required Guardian documents are substantive. P2 standalone education library
is deferred; the existing educational Scam Check is included. No frontend/core rewrite,
official NBK call, real banking transaction, paid service, force push or main merge.

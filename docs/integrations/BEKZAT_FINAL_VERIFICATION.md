# Bekzat — final integration verification, 2026-11-14

Implementation checked: `84c793028accd21c293dd50be4630072c816e924`; baseline main `a02d20dcc857001de364e0b0f12a66ce72db0c12`.
This supersedes the earlier 97.25%/171-case report retained in Git history. Subsequent
documentation commits have their own final CI recorded in the release package; the
implementation hash above intentionally does not refer to this document's future hash.

## Result and limits

**99.50% on the unchanged 100-row matrix: 98 DONE, 0 PARTIAL, 2 BLOCKED, 0 MISSING.**
T09 real Telegram and T10 durable Retry-After are now DONE. D17 independent core-owner
review and D18 joint frontend/mobile/SOC acceptance remain BLOCKED. New Timeline/Health
features are assessed separately and do not inflate the original denominator.

Existing bot connected through protected local setup; no bot/account was created by
the agent. The confirmed private chat received one RU and one KK alert. Total accepted
sendMessage calls: 11 (2 alerts, 3 consent prompts, 6 service/invitation messages), within
the separately authorized limit of 12. Actual suspicion/acknowledgment callbacks were
persisted and visible after fresh SOC reads. Both contacts revoked, polling stopped,
send grant closed. Provider acceptance and user interaction evidence are distinguished
in [TELEGRAM_LIVE_ACCEPTANCE.md](TELEGRAM_LIVE_ACCEPTANCE.md).

Real provider outages/429, non-consenting/group/foreign chats were not exercised on
Telegram. Their controls were tested with adapters/dispatcher and real PG/Redis.
No NBK, real financial data, bank operations or production deployment occurred.

## Changes and failures addressed

- Explicit provider rejection now persists next_attempt_at; max 3 reserved attempts,
  Retry-After <=86400s and strictly before cooling expiry. Each retry rechecks consent,
  core state and deadline. Unknown delivery/crashed claims never trigger blind resend.
  Pre-fix delayed-retry regression failed; new scheduling and concurrent-claim tests pass.
- Standalone Telegram worker survives bounded DB/Redis dependency errors. The regression
  failed before the loop fix; two reconnect/once-mode tests now pass. Logs use fixed codes.
- Windows setup recovered the already saved DPAPI secret after Get-Acl module mismatch.
  Explicit host-matching Security module and DACL-only persistence preserve protection,
  owner and audit SACL. Synthetic roundtrip/ACL validation passed. No token re-entry or
  rotation; PSReadLine history preserved. Local helper scripts remain outside repository.
- Incident Timeline projects existing persisted core facts/audit with typed bilingual
  events, correlations, static importance and signed cursor pagination. No duplicate audit.
- Health details exposes cached queue/dependency/worker/configuration state, including
  failures when Redis is unavailable. SOC signature/role required; this endpoint alone
  uses bounded process-local admission. All other API limits still fail closed on Redis.

## Verification

| Check | Observed result |
|---|---|
| Full local verify.sh | ALL GREEN: Ruff/format, strict mypy, pytest, tsc, 12 frontend tests/build, both Compose configs |
| Full portable backend suite | 192 passed / 7 live-only skipped; same counts in CI |
| Full PostgreSQL16 + Redis7 integration suite | 151 passed; includes all 7 live-only cases |
| Unique backend cases | 199 = 48 existing core + 151 integration; reruns are not summed |
| New cases this stage | 28 = 10 retry/reconnect/concurrency + 16 insights + 2 new contract examples |
| Independent A / A+B / A+B+C CI integration suites | 57 / 98 / 133 passed |
| Frontend | 12 existing tests, TypeScript and production build PASS; frontend unchanged |
| Docker | Five healthy services; fresh normal/scam/hub E2E PASS |
| Real dependency restart | Redis stop/start, PG stop/start, worker restart PASS; degraded states observed then recovered; one saved suspicion remains |
| PostgreSQL migrations | Fresh upgrade; old 0004 -> head; head -> 0001 -> head; alembic check PASS |
| Migration structure | New 0002a retry columns/index plus 0003a/0004a merge revisions; published revisions unchanged |
| Contracts | 15 request/response examples validated; full exported OpenAPI equals app |
| Compatibility | Existing main paths/components identical; 12 additive paths / 15 operations overall |
| Ownership | No diff in frontend, scoring/services/core schemas/transfer/SOC routes/entities or base Compose |
| Secret pattern scan | Known private-key/GitHub/Telegram/AWS patterns absent in tracked files; limited scan, not a proof of universal secret absence |

The first local PostgreSQL run overlapped frontend installation/build: 150 passed,
one existing gateway classification test exceeded its outer 2s wall-clock budget while
waiting for a thread-pool dependency, before adapter validation. Its failed log is
preserved. A full serial rerun after build completion passed 151/151 with unchanged
code/timeouts/assertions. CI independently passed 151/151. Resource contention is the
likely explanation; this observation is not a measured production latency guarantee.

New APIs, SOC capability required:

- GET `/api/v1/integrations/soc/transactions/{transaction_id}/timeline`
- GET `/api/v1/integrations/health/details`

Read-only metrics do not report a new fraud score. DB failure yields queue=null, not zero;
test_enabled reports adapter configuration, not successful Telegram reachability.
Cursor as_of cutoff is not a database snapshot against a later backdated commit. See
[Timeline spec](INCIDENT_TIMELINE_SPEC.md) and [Health report](INTEGRATION_HEALTH_REPORT.md).

## Runtime and latency

| Scope | N | p50 ms | p95 ms | p99 ms | Errors |
|---|---:|---:|---:|---:|---:|
| engine_only | 500 | 5.7827 | 15.5109 | 32.7947 | 0/500 |
| http_database | 100 | 79.2297 | 446.7354 | 662.804 | 0/100 |
| integration_enqueue_http | 20 | 76.9344 | 116.1098 | 123.2384 | 0/20 |
| queue_wait | 20 | 9774.138 | 13896.28 | 14367.428 | 0/20 |
| integration_processing | 20 | 26.218 | 41.138 | 133.19 | 0/20 |
| integration_total | 20 | 9794.754 | 13923.344 | 14397.282 | 0/20 |

Nearest-rank percentiles; Windows Python3.12.16 with local Docker Desktop PG16/Redis7.
Engine: 500 serial measurements after 30 warmups, real Redis14, existing scorer/graph,
no HTTP/SQL. HTTP+DB: 100 evaluations after 10 warmups, actual loopback HTTP/PG/scorer;
synthetic reused sender, core risk decisions may vary with velocity/history. A valid
blocked/cooling response is not a transport error. Integration: 20 gateway-only fake
jobs submitted in a burst, one worker with 0.5s loop, existing default rate budget.
Queue and processing durations derive from saved QUEUED/STARTED/COMPLETE audit timestamps;
client polling time is excluded. N=20 p99 is the maximum; processing includes MOCK
cache/DB work but no real Telegram network. No concurrent builds/tests during measurement.
These are distinct scopes on one host, not a comparison or evidence of a speedup, SLA
or causal regression. The worker's serial loop explains queue accumulation under a burst.
The observed engine p95 (15.51ms) exceeds the core benchmark script's 15ms target in
this run, although it remains below the SPEC's 50ms scoring target. No 15ms budget pass
is claimed. HTTP p95 is 446.74ms, and queue p95 is 13.90s under the 20-job burst; these
are explicit demo-host limitations, not hidden behind engine-only numbers. Core tuning
was not authorized and no thresholds or financial rules were changed to improve them.

Machine-readable observations: [benchmark_results.json](benchmark_results.json),
[operational_recovery.json](operational_recovery.json),
[telegram_live_evidence.json](telegram_live_evidence.json). These contain sanitized
states/counts/timestamps, not private Telegram addresses or raw provider updates.

Integrations remain a separate optional POST after evaluate; provider I/O is not inside
the scoring path. Client crash between core commit and optional POST does not create an
unsolicited job. Existing resolve-cooling remains the sole financial resolution path;
contacts cannot invoke it. Core functionality is exercised by the inherited core suite.

## GitHub and external acceptance

| PR | Checked implementation head | CI |
|---|---|---|
| [#1](https://github.com/foxfordkz-cyber/qadamxbcc/pull/1) | `59550de781c146e517e082cada22f64bd4405e32` | [SUCCESS](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/43563302792) |
| [#2](https://github.com/foxfordkz-cyber/qadamxbcc/pull/2) | `be7489d7bfb4f9e6a392d3c1088865a31c9db083` | [SUCCESS](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/43563495541) |
| [#3](https://github.com/foxfordkz-cyber/qadamxbcc/pull/3) | `4533b16769a04a71b3756bc77119b276752377cf` | [SUCCESS](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/43563561759) |
| [#4](https://github.com/foxfordkz-cyber/qadamxbcc/pull/4) | `84c793028accd21c293dd50be4630072c816e924` | [SUCCESS](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/43565606217) |

Review order: #1 -> #2 -> #3 -> #4. All open Draft, mergeable at final review, no submitted
human reviews. Normal pushes only; no main merge, force push or GitHub secret change.
AI-assisted implementation under Bekzat's direction, not independent human sign-off.

Local synthetic hackathon demo: **GO**. Team integration: **GO for feature/test wiring
and review**, final merge/UI sign-off pending. Production: **NO-GO** (bank IAM, approved
provider integration, retention/encryption/operations and security review outstanding).
Frontend receives typed examples, states/errors/retry rules, RU/KK strings, new SOC APIs
and demo presets. Trusted Circle is deferred; educational Scam Safety reuses existing
CoolingQuestionnaire fields as handoff copy, no new blocking/financial engine.

## Reproduction and isolation

Run `bash verify.sh`, then `uv run pytest tests/integrations` from backend with
BCC_TEST_DATABASE_URL pointing to explicitly named `bcc_integration_test` and
BCC_TEST_REDIS_URL to Redis15. Live fixtures isolate schemas. Migration validation
used separate `bcc_integration_test_upgrade`; synthetic demo uses bcc_shield/Redis0;
engine benchmark uses Redis14. The prior bcc-bekzat-final project is stopped with its
volumes preserved; fresh fake bcc-bekzat-premium is the active local demo. Live bot
acceptance data resides in its separate DB on the preserved prior PG volume; polling
is stopped. Never reseed core tables over existing integration history.

The release evidence package contains sanitized live results, local verification logs,
Compose demo/recovery/migration results, benchmark inputs/results, contract exports,
source archive and checksums. It excludes private config, IDs, grants, invitation links,
raw Telegram updates and provider credentials. Earlier audit packages remain historical.

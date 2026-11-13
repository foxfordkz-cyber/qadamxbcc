# Integration verification record

Date: 2026-11-13. Initial audited main: `627fa88`; final compatible main:
`a02d20dcc857001de364e0b0f12a66ce72db0c12`. Integrated source: `179b0ca`.
The final documentation-only commit does not change that tested Python/configuration.
Damir's intervening hybrid ML, biometrics and frontend changes were retained through
ordinary merges into A, B and C. All counts below refer to the current core baseline.

## Results

| Check | Observed result |
|---|---|
| Full `bash verify.sh` | PASS: Ruff check/format, strict mypy, backend tests, TypeScript, frontend tests/build, both Compose configurations |
| Portable backend suite | 130 passed; 6 PostgreSQL-only cases intentionally skipped without live-service variables |
| PostgreSQL 16 + Redis 7 integration suite | 88 passed, including all 6 live concurrency/locking cases |
| Distinct backend cases covered | 136 = 48 existing core + 88 new integration cases; repeated runs are not added again |
| Existing frontend suite | 12 passed; no frontend test is attributed to Bekzat |
| SQLite migrations/model parity | PASS through the existing project verification suite |
| Real PostgreSQL migration round trip | head → 0001 → head PASS; `alembic check`: no new upgrade operations |
| Existing OpenAPI compatibility | All current-main paths/operations and component schemas structurally unchanged; 10 new paths / 13 operations |
| Core/frontend ownership | No diff from a02d20d in frontend, backend/app/services or backend/app/schemas |
| Docker smoke | Five services healthy: PostgreSQL, Redis, backend, frontend, integration worker |
| Full fake E2E | PASS: seeded core evaluate → cooling_off → two-party consent → worker → fake delivery → suspicion → SOC; core stays cooling_off |
| Tracked-file secret pattern scan | No private key, GitHub token, Telegram token or AWS access-key pattern detected; not a comprehensive security audit |

The 88 new parametrized cases comprise A: 38, B: 30 and C/final integration fixes: 20.
There are 82 portable integration cases and 6 live-only cases. Coverage includes
owner/role isolation, forged/expired tokens, invitation reuse, consent/revocation,
duplicate events, bounded adapter timeouts, safe retry, stale/corrupt cache, malformed
provider replies, RU/KK privacy templates, failure degradation, SOC visibility,
worker restart, structured logs and dependency health. The six PostgreSQL cases check
concurrent consent binding, unique notification enqueue/delivery, gateway reservation,
orchestration claims, stale-session revocation and core foreign-key lock compatibility.

## Reproduction

```sh
bash verify.sh
export BCC_TEST_DATABASE_URL=postgresql+asyncpg://bcc:bcc@localhost:5432/bcc_integration_test
export BCC_TEST_REDIS_URL=redis://localhost:6379/15
cd backend
uv run pytest tests/integrations
```

Live tests require a disposable database name beginning `bcc_integration_test`, create
and drop a unique schema per case, and flush the dedicated Redis database 15. Never
point these variables at shared/production services. CI provisions disposable services.
See [Docker demo instructions](ORCHESTRATION_HANDOFF.md#reproducible-fake-docker-demo)
for the optional overlay, synthetic seed and localhost-only smoke script. Start from
a fresh disposable project/volume; do not rerun the core seed over integration history.
Python: 3.12.16 locally; aiogram: 3.31.0; PostgreSQL: 16; Redis: 7.

## GitHub evidence

| Draft PR | Checked source head | Successful PR workflow run |
|---|---|---|
| [A #1](https://github.com/foxfordkz-cyber/qadamxbcc/pull/1) | fc48185 | [43445085289](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/43445085289) |
| [B #2](https://github.com/foxfordkz-cyber/qadamxbcc/pull/2) | 8d27c43 | [43445085569](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/43445085569) |
| [C #3](https://github.com/foxfordkz-cyber/qadamxbcc/pull/3) | 179b0ca | [43447046010](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/43447046010) |

C's run passed both `verify` (full oracle plus live PostgreSQL/Redis tests) and
`compose-demo` (build, health, seed, restart, full fake flow and teardown). A subsequent
documentation-only commit triggers its own checks; use the PR checks for latest-head
status rather than interpreting the historical links as evidence for a different SHA.
No branch protection configuration or required-check policy was changed.

## Measured scoring latency

The existing core-owned `scripts.benchmark_antifraud.benchmark` was run against pinned
main a02d20d and integrated source 179b0ca using the same resolved Python environment,
real Redis on localhost database 14 and the same running services. Each source had
3 sequential runs of 500 evaluations after 30 warmups. Build/test activity finished
before measurement. This measures warmed engine + ML/graph/Redis, excluding HTTP,
SQL persistence, frontend and adapter delivery. Runs were not randomized/interleaved.

| Source | Run 1 p95 ms | Run 2 p95 ms | Run 3 p95 ms | Median of run p95 ms |
|---|---:|---:|---:|---:|
| Current main a02d20d | 2.393375 | 3.373515 | 4.054405 | 3.373515 |
| Integrated 179b0ca | 2.645865 | 3.445220 | 2.662355 | 2.662355 |

Observed difference: -0.711160 ms (-21.08%). This is not
evidence of a speedup or a production SLA: only three runs were measured and their
ranges overlap. No scoring-path adapter calls were introduced; the dedicated test
also verifies that scoring/enqueue never call the gateway. The initial 627fa88
fakeredis measurements are historical and are not used in this comparison.

## Smoke trace and resolved verification issues

Local smoke returned `PASS`, transaction `5d0f5c18-6d1e-4169-961b-64b7019c8d8b`,
correlation `2be5f7b9-85f8-46ba-92a9-43e506a23061`, `core_status: cooling_off`,
`notification: SUSPICION_REPORTED`, `gateway_source: MOCK`. Matching correlation events
appeared in the worker/backend logs. The script revoked its contact on completion.

An early live run hit an overly broad wall-clock assertion while Docker builds were
running. The test now measures adapter cancellation itself, keeping the provider's
timeout bounded independently of slow database/setup work; final live suite: 88/88.
An application-import health probe exceeded its budget on this Windows Docker host;
the Docker worker probe now checks Redis heartbeat without importing the application.
An interrupted local container recreation was completed with normal Compose up/wait;
all five final services were healthy before the successful smoke and latency runs.

Real Telegram sends: zero. Real NBK access: zero. Real money movements: zero.
Production deployments/migrations: zero. Local synthetic demo: GO. Production: NO-GO
until bank IAM, provider authorization/contracts, data retention/encryption, operational
monitoring and independent security review are completed. Fake and synthetic behavior
does not verify real Telegram delivery or any official banking interoperability.

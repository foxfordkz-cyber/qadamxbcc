# Integration verification record

Date: 2026-11-13. Baseline `627fa88`.

Baseline full `verify.sh`: PASS, 40 backend tests, 6 frontend tests, Ruff,
strict mypy, TypeScript, Next.js build and Compose configuration validation.
No pre-existing GitHub Actions workflows or open PRs were found during audit.
PostgreSQL 16 and Redis 7 were started in the isolated `bcc-bekzat-audit` Compose project.

PR A introduces 38 test cases: 36 portable cases and 2 PostgreSQL concurrency cases.
Portable suite: 76 passed, 2 intentionally skipped without live-service variables.
The 36 portable integration cases also passed against PostgreSQL and real Redis.
Concurrency and migration round-trip outcomes are recorded in the PR verification
description after completion. The full project oracle runs for each branch before push.

Real Telegram sends: zero. Real NBK access: zero. Production changes: zero.

Run `bash verify.sh` for the full oracle. For live tests use a disposable database
whose name starts `bcc_integration_test` and isolated Redis database 15:

```sh
export BCC_TEST_DATABASE_URL=postgresql+asyncpg://bcc:bcc@localhost:5432/bcc_integration_test
export BCC_TEST_REDIS_URL=redis://localhost:6379/15
cd backend
uv run pytest tests/integrations
```

Live tests create/drop a unique schema per case. Redis database 15 is flushed by
the live fixture; it must be dedicated to tests. Do not point these variables at
shared/production services. CI provisions disposable service containers.

Latency baseline: 3 runs × 200 engine evaluations, identical seeded graph and
fakeredis, Python 3.12 on this Windows host. p95: 5.292 / 7.614 / 8.757 ms. This is
an engine microbenchmark, not HTTP/PostgreSQL latency or a production SLA. The
combined-branch report will include the repeated measurement and methodology.

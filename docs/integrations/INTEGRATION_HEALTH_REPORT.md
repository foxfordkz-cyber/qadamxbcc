# Integration Health — bounded SOC diagnostics

GET /api/v1/integrations/health/details is additive. The existing /integrations/health
response is preserved. No core/frontend files or financial decisions are changed.

## Response semantics

- checked_at and cache_seconds=5 describe sample freshness.
- database / redis: ok or unavailable. No exception text or connection strings.
- worker: ok, not_seen, or unknown when Redis cannot report the heartbeat.
- telegram: disabled, fake_enabled or test_enabled describes configuration, not verified
  external delivery or Telegram availability. No real Telegram probe is made.
- gateway: disabled or mock_ready. The in-process synthetic adapter is never represented
  as real NBK availability.
- queue: notifications_queued (includes delayed/in-flight queued rows),
  notifications_delayed (future due time), notifications_failed, runs_pending.
  Counts cover this isolated application's database; null means DB sampling failed.
- last_successful_processing: latest persisted NOTIFICATION_SENT/INTEGRATION_COMPLETE
  audit timestamp, nullable. Historical failure counts do not reset automatically.
- status summarizes dependency health; it is not a financial/risk decision or a
  guarantee that every historical notification succeeded.

## Security and load

The endpoint verifies the same HMAC capability, expiry and SOC role. It deliberately
uses a separate bounded process-local budget so diagnostics remain readable during a
Redis outage: 30 requests/principal/minute, at most 256 active principals per process.
Excess: 429 with Retry-After:60; capacity exhaustion: 503. This exception applies only
to this read-only diagnostic endpoint; existing integration APIs still fail closed
when their Redis limiter is unavailable. No credentials are minted by this endpoint.
Production multi-instance deployment requires a reviewed shared diagnostic rate limit.

A per-application lock shares one cached sample among concurrent callers. At most one
DB/Redis sample per five seconds per process; DB work is bounded by 1 second and Redis
by 0.5 seconds. No Telegram/NBK network requests, webhook checks or secret/config dumps.
Cache-Control:no-store prevents browser/proxy persistence. During core startup failure
the API may not start; container/service supervision remains necessary.

## Evidence

Tests exercise counts, last-state privacy, cache reuse, concurrent single sampling,
SOC-only access, malformed credential rejection, Redis outage without auth bypass,
unchanged fail-closed behavior on existing APIs, DB failure/recovery and bounded budgets.
Checked JSON examples, generated OpenAPI and bilingual status labels accompany this API.
Final full CI, real PostgreSQL/Redis and Docker results are recorded in
BEKZAT_FINAL_VERIFICATION.md. Tests do not establish a production availability SLA.

# Guardian performance evidence

Measurements on 2026-11-14, Windows Python 3.12.16, Docker PostgreSQL 16/Redis 7,
synthetic fixtures. Inherited demo PostgreSQL uses synchronous_commit=off; Redis has no AOF/RDB persistence. These figures do not represent a durable production deployment. No tests/builds ran during measured workloads. Nearest-rank quantiles;
one local run is not a production SLA or statistical confidence interval.

## Full Guardian snapshot (milliseconds)

| Scope | p50 | p95 | p99 | Errors / attempts |
|---|---:|---:|---:|---:|
| Engine + Redis, N=500 | 1.65 | 4.88 | 6.65 | 0/500 |
| HTTP + database, N=100 | 76.17 | 106.00 | 138.76 | 0/100 |
| Integration processing, N=20 | 30.35 | 92.41 | 207.96 | 0/20 |
| Queue wait, N=20 | 427.93 | 955.51 | 955.79 | 0/20 |

Engine includes graph + real Redis14, 30 warmups, 500 measurements; HTTP includes
loopback/API/engine/PostgreSQL, 10 warmups, 100 measurements. Twenty gateway-only jobs
measure persisted enqueue → start → complete timestamps, not client polling. At N=20,
p99 is the sample maximum. No live Telegram timing is measured. Fault recovery is a separate workload: one Redis-reconnect diagnostic HTTP response took 7217.72ms and initial cold probes exceeded a 10s client timeout. These observations are retained rather than mixed into the steady-state percentiles; no strict diagnostic HTTP latency SLA is claimed.

Original implementation's fresh host snapshot had queue p95 9213.08ms;
Guardian's full snapshot had 955.51ms. The old and new Compose
databases had different accumulated history, so this is not a controlled core/HTTP speedup
claim. Scoring/graph/velocity code is unchanged. Earlier 15.51/446.74/41.14ms figures are
historical measurements, not interchangeable baselines for this machine state.

## Controlled queue pacing comparison

Same Guardian image, host, database, owner and fixture; only the pacing expression was
changed for the control worker. Exactly one worker ran at a time. Existing admission
limits were retained; 61-second intervals avoided rate-limit interference. Each side
required a fresh heartbeat after the previous heartbeat TTL and one completed warmup
job, then a measured 20-job batch. Both batches completed without errors.

| Pacing | Queue p50 ms | Queue p95 ms | Queue p99 ms |
|---|---:|---:|---:|
| Fixed 500ms | 4699.79 | 8999.84 | 9496.69 |
| Bounded fake drain | 481.61 | 815.77 | 822.79 |

Processing p95 in the same pair was 30.79ms
versus 85.96ms; not every metric improved.
This single A-then-B pair supports lower queue delay for this synthetic workload. It
does not establish production capacity or core-engine improvement. SQL history naturally
grows between serial batches; there is no claim of identical byte-for-byte DB snapshots.
An initial experiment lacked a warmup and included cold worker startup. Its separate
`guardian-queue-ab-cold-start.json` is retained, excluded from the warmed comparison.

The worker previously slept 500ms even while work remained. Fake mode now uses 10ms
between completed jobs for nine consecutive short gaps, then 500ms; idle and real Telegram
test mode keep 500ms pacing. No retries, dedup rules or financial decisions were changed.
Retention cleanup runs at most once per minute in bounded batches. Cold-start import
delay on this 8GB host also required a longer initial worker healthcheck grace (120s);
steady-state checks and timeout remain unchanged. Failed initial startup evidence is
retained; the subsequent stack health and E2E are successful.

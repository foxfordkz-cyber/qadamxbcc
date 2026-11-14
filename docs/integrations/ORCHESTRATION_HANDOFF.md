# Integration orchestration and local demo handoff

Updated 2026-11-14: the demo script now exercises normal, scam and hub scenarios. See [three-demo guide](BEKZAT_DEMO_GUIDE.md) and [complete frontend contracts](BEKZAT_FRONTEND_HANDOFF.md).

Review stack: [A #1](https://github.com/foxfordkz-cyber/qadamxbcc/pull/1) →
[B #2](https://github.com/foxfordkz-cyber/qadamxbcc/pull/2) →
[C #3](https://github.com/foxfordkz-cyber/qadamxbcc/pull/3).
Core owner reviews minimal router/model registration and reversible migrations;
Damir/mobile and SOC owners consume the additive contracts. No frontend is rewritten.

## Execution boundary

1. Mobile evaluates a synthetic transfer using the unchanged existing endpoint.
2. After receiving its committed transaction UUID, the owner may POST an integration
   request. This endpoint only validates ownership and persists a job (202).
3. The separate worker creates the optional consent-gated contact alert and obtains
   optional mock enrichment. Neither operation calls or replaces TransferService.
4. Mobile polls its run; SOC reads the advisory view alongside the existing feed.
5. Telegram callbacks may acknowledge or report suspicion. Core status is unchanged.

One canonical run exists per transaction. `(owner,idempotency_key)` is unique, and
keys are bound to transaction/contact/identifier. Repeated events with different
keys but the same transaction and payload reuse the run. Different payloads return
409; separate contact/gateway APIs remain available for explicitly new checks.
Correlation IDs propagate through newly created notification, gateway and job audit
events. If a notification already exists from a prior independent request, its
original correlation ID is preserved and the run links it by resource ID.

Runs transition QUEUED → RUNNING → COMPLETE or DEGRADED. COMPLETE means requested
orchestration finished; it does **not** mean Telegram delivery or payment approval.
Check the notification lifecycle separately. UNKNOWN/UNAVAILABLE evidence or disabled
requested adapters yields DEGRADED. Worker exceptions retry at most three total
attempts with bounded exponential backoff, then FAILED. Stale claims can resume after
30 seconds; downstream unique keys prevent duplicate work. Provider read retries
are bounded separately. Telegram's ambiguous sends are never blindly retried.

Worker network work has an outer budget; all provider/cache calls are individually
bounded. No account/transaction row lock is held across provider I/O. Integration
failure cannot roll back a transfer already committed by the core API. Durable
PostgreSQL queues survive Redis restarts; Redis holds cache, rate counters and a
30-second worker heartbeat. A missing heartbeat is visible as degraded health.

## Additive frontend/SOC contract

| Route | Consumer and behavior |
|---|---|
| POST `/api/v1/integrations/transactions/{id}` | Owner; Idempotency-Key UUID; `{contact_id?:UUID,gateway_identifier?:"SYN-*"}`; at least one required; 202 RunOut |
| GET `/api/v1/integrations/transactions/{id}` | Owner of that transaction; RunOut |
| GET `/api/v1/integrations/soc/transactions/{id}` | SOC only; unchanged core_status, run, notifications, mock external_checks and sanitized audit events |
| GET `/api/v1/integrations/health` | SOC only; bounded DB/Redis status, worker heartbeat, adapter modes |

SOC view bounds checks to 100 and events to 300; it is a per-transaction demo view,
not a paginated long-term audit export. Pending standalone external checks are omitted
from the result list until completed, while the requested audit event remains visible.
Authorization and rate-limiter errors can return 401/403/429/503 before health probing.
Core `/health` remains available independently of integration configuration.

For Damir: keep the existing transfer response intact; offer the separate optional
trusted-contact action only for `cooling_off`. Show pending consent, queued, sent,
failed and expired distinctly. Do not label SENT as "read" or advisory suspicion as
"bank blocked". Never expose simulator credentials or invitation tokens in analytics.
The demo capability issuer is an operator tool; a real bank session/IAM bridge is
outside this MVP and requires core-owner review.

## Reproducible fake Docker demo

The existing `docker-compose.yml` still starts without Telegram credentials. The
optional `docker-compose.integrations.yml` adds a worker profile and forwards all
integration settings. Use a fresh disposable Compose project/volume for the demo.
Do not rerun the core seed over integration history: the existing seed owns core
tables and is not an integration retention/reset tool.

From the repository root in Bash (PowerShell users can set the same environment variables):

```sh
export BCC_INTEGRATIONS_ENABLED=true
export BCC_INTEGRATIONS_TELEGRAM_MODE=fake
export BCC_INTEGRATIONS_SIGNING_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')"
docker compose -f docker-compose.yml -f docker-compose.integrations.yml --profile integrations up -d --build --wait
docker compose exec -T backend python -m scripts.seed_bcc
docker compose restart backend
docker compose -f docker-compose.yml -f docker-compose.integrations.yml --profile integrations up -d --wait
cd backend
uv run python -m scripts.demo_integrations
```

The script uses only localhost, the existing deterministic synthetic seed accounts,
fake chat 123 and SYN-REVIEW-001. It checks the full flow, reports only safe IDs and
statuses, and revokes its contact afterward. Use a fresh seed environment for repeatable
scoring; core velocity state intentionally persists between transfers. It never calls
resolve-cooling or sends a real Telegram message. CI runs this same complete stack.

Use `uv run python -m app.integrations.worker --once` for one local worker pass;
`--health` checks its heartbeat. Disable `BCC_INTEGRATIONS_ENABLED` to disable the
subsystem, or independently disable Telegram/gateway. Stop the optional worker when
integrations are disabled. Secrets belong only in process environment/untracked `.env*`.

## Review and production boundary

No main merge, production migration, deployment, real-person messaging or bank
connection is part of this work. Production remains NO-GO pending bank IAM, a
reviewed data-retention/encryption policy, real-provider authorization/contracts,
operational monitoring and independent security review. Local fake demo GO depends
on the recorded verification results, seeded data and healthy Compose services.

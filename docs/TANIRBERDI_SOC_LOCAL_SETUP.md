# Local SOC workspace and server capability

The SOC workspace reuses the existing `/api/v1/integrations/guardian/soc/cases`,
transaction timeline, summary, enrichment and diagnostic APIs. It does not change
the transfer decision, release money, or contact a real NBK/Telegram provider.

## One-command offline rehearsal on Windows

From the repository root, after installing dependencies and building the frontend:

```powershell
.\scripts\start-local-demo.ps1 -SocDemo -NoBuild -FrontendPort 3020 -BackendPort 8020
```

Omit `-NoBuild` to install locked dependencies and build first. `-SocDemo` always
creates a **new** SQLite database inside `.local-checks/rehearsals/`; prior demo
databases and occupied ports are never reset or stopped. Both services bind to
`127.0.0.1`. Open `http://127.0.0.1:3020` and select the SOC tab.

The runner uses the real backend rules/graph/ML and case APIs with in-process
fakeredis, a fake Telegram adapter and the MOCK gateway. A worker shares the same
Redis instance. It seeds all three transfer presets and two linked cases. The
cooling-off case contains consent, fake delivery and `SUSPICION_REPORTED` events;
an explicit owner demo report links this transaction to its case. A contact report
cannot claim transaction authority, so that backend restriction is preserved.

A random signing key and a one-hour SOC capability are created in launcher memory
and passed to child processes only through server environment variables. They are
not printed, persisted in the launch record, exposed in the browser or stored in
localStorage. The launch record stores PIDs, paths and the expiry time only. The
frontend reports `integrationSessionExpired` after expiry; restart a fresh
rehearsal to obtain a new session. It never auto-mints or retries a capability.

Stop only the PIDs in the specific `.local-checks/local-demo-*.json` record when
finished. The ordinary launcher without `-SocDemo` keeps integrations disabled.

## Existing local backend, manual operator setup

The backend operator may issue a short-lived `soc` capability with the existing
`backend/scripts/integration_token.py` CLI. Supply it to the Next **server** as
`BCC_SOC_CAPABILITY`; never use a `NEXT_PUBLIC_` variable, URL, client-side storage,
or browser Authorization header. Example variable names (placeholders only):

```dotenv
BCC_ENVIRONMENT=local
BCC_API_MODE=live
BCC_API_URL=http://127.0.0.1:8000
BCC_SOC_CAPABILITY=<operator-issued-short-lived-soc-capability>
```

Run Next with `npm run start -- --hostname 127.0.0.1`. The capability must be signed
by the same local backend key, have role `soc`, and expire within one hour. The
frontend BFF only validates format/expiry; the backend verifies the signature,
role and principal rate limit. Browser-supplied credentials are never forwarded.

The BFF is intentionally unavailable in static mode, API demo mode, public hosted
demos, mobile LAN mode and pilot mode. It requires loopback URL/Host, checks
forwarded host/address and same-origin mutations, restricts all paths and query
parameters, and validates response schemas before returning minimized JSON.
**Bind to loopback:** Host/Origin checks are not network authentication and Next
route handlers do not expose a trusted socket peer address. This local capability
flow is not production IAM. Backend pilot mode also disables demo integrations.

## Contract and retry behavior

- Case list pagination uses opaque `next_cursor`; history/notes use
  `next_after_version`. Status/operator/time filters apply to loaded records
  because the existing backend list endpoint has no such server filters.
- Every mutation carries the exact caller `Idempotency-Key` and expected version.
  The proxy never generates replacement keys or retries a mutation.
- A stale-version 409 requires re-reading current data and explicit confirmation
  with a new key. An unknown mutation outcome may be retried only with its original
  body/key. Safe, status-matched backend error codes are preserved.
- Missing/expired capability, disabled dependencies, expiry and rate limits stay
  distinct. Valid `Retry-After` values are forwarded; health remains an observed
  dependency snapshot and does not probe real providers.

Verification: `frontend/tests/soc-integrations.test.ts` checks the checked-in backend
API examples, route/query bounds, local access, secret stripping, idempotency and
error behavior. `backend/tests/test_local_soc_demo.py` exercises the linked-case
chain, fake worker, health and the refusal to reuse an existing rehearsal database.

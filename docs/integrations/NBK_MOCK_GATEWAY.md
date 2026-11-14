# Mock NBK-style Antifraud Enrichment Gateway — synthetic demonstration only

This is not an official National Bank of Kazakhstan integration, contract, blacklist
or source. It has no NBK URL, credentials, banking connection or real identifiers.
Every result carries `source: MOCK` and `advisory_only: true`.

## Boundaries

`ExternalGatewayProtocol` defines a read-only adapter seam. `MockGatewayAdapter`
returns in-process sandbox data. `GatewayClient` applies per-attempt timeouts,
at most two attempts and 20 ms backoff for transient unavailability/timeouts only.
`GatewayResponseValidator` rejects unknown fields, incorrect identifiers, unofficial
source labels, unverified/future/expired results and validity intervals over 5 minutes.
`GatewayService` manages cache and durable idempotency; `GatewayAuditService` records
sanitized outcomes in the common audit table. None imports the antifraud decision engine.

Only identifiers matching `SYN-[A-Z0-9-]{1,40}` are accepted:

| Fixture | Status | Meaning |
|---|---|---|
| SYN-CLEAR-001 | CLEAR | No synthetic risk markers in this fixture, not payment approval |
| SYN-REVIEW-001 | INDICATORS | SYNTHETIC_REVIEW marker, not a finding about a person |
| SYN-NETWORK-001 | INDICATORS | SYNTHETIC_NETWORK_SIGNAL, synthetic network demonstration only |
| Other valid SYN-* | UNKNOWN | Explicitly unknown synthetic fixture |

Timeout/unavailability → UNAVAILABLE. Malformed, unverified or expired provider data,
and internal adapter exceptions → UNKNOWN with a fixed error code. Neither outcome
means a customer is fraudulent or an operation may proceed. Existing authorized
policy owns financial decisions; this MVP does not add a decision policy.

## Cache, freshness and retries

Redis cache keys hash the synthetic identifier and include provider/schema version.
Only validated, verified results are cached. TTL never exceeds provider expiry or
60 seconds; every cache hit is revalidated. Stale/corrupt cache and Redis failure
fall back to bounded provider lookup. Failure results are not cached. No stale
result is relabeled current. The API rate limiter independently fails closed if
Redis is unavailable. Provider cache failure is safe for internal service callers.

`Idempotency-Key` is a UUID scoped to the authenticated owner. A unique database row
reserves it before any provider call; different payload under that key returns 409.
Concurrent incomplete requests return `external_check_in_progress` (retry the same
key later). A claim left incomplete for 30 seconds returns an explicit unavailable
result; it is never silently treated as a successful check. Completed replays keep
the same ID and audit event. Expired replays return UNKNOWN/EXPIRED_RESULT and
`fresh:false`; use a new key for a new check. Read-only provider retries are safe;
no real financial action or remote write exists.

Defaults: 0.2 seconds per attempt, two attempts + 0.02 second backoff; cache operations
are independently capped at 0.2 seconds each. Database/HTTP timing is separate.
All calls are made from separate enrichment requests/worker operations, outside scoring.

## API and storage

`POST /api/v1/external-checks`: owner role, Idempotency-Key header, body
`{"identifier":"SYN-REVIEW-001","transaction_id":"<optional own transfer UUID>"}`.
`GET /api/v1/external-checks/{check_id}`: owning account or SOC role. Responses contain
ID, correlation ID, optional transaction ID, result, cache_hit and fresh. No name,
IIN, phone, amount, bank account or Telegram delivery address is included.

Audit follow-up (2026-11-14): every external-check response also includes computed
`description_ru` and `description_kk`. These are generated from normalized enum codes,
including error/freshness states and markers, with an explicit MOCK/advisory notice.
Raw provider text is never rendered. Existing fields and the cached provider contract
are preserved. The same response model supplies the orchestration SOC view.

Migration `0003_external_checks` adds only the durable external check table. Results
are synthetic JSON; unique `(owner_id,idempotency_key)` prevents duplicate audit/checks.
Both migration directions are supported. No changes to transaction/risk schemas.

For future provider work, implement the protocol behind a separately reviewed
authentication, verification, consent and data-transfer policy. The MOCK source
contract must not be relabeled as an official NBK contract.

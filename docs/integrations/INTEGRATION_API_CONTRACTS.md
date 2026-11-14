# Integration API contracts

Canonical typed contract: FastAPI `/openapi.json`. Prefix `/api/v1` below is omitted.
All new routes require a signed demo capability; no caller-supplied account header
is trusted. JSON errors use `{ "detail": "stable_error_code" }` for domain errors;
FastAPI validation uses its standard 422 detail list. Existing transfer/SOC schemas
and lowercase `approved`, `cooling_off`, `blocked` values remain unchanged.

| Method/path | Role | Request / response |
|---|---|---|
| POST `/trusted-contacts` | owner | `{owner_consent:true,language:"ru" or "kk"}` → 201 contact, one-time invitation_token, expires_at; no-store |
| GET `/trusted-contacts` | owner | aggregate state + contacts (including revoked history) |
| DELETE `/trusted-contacts/{id}` | owner | idempotent consent revocation |
| POST `/trusted-contacts/transactions/{id}/notifications` | owner | `{contact_id:UUID}` → unique notification, correlation_id, expires_at, advisory_only:true |
| GET `/trusted-contacts/transactions/{id}/notifications` | owner | owner's notification states only |
| GET `/trusted-contacts/notifications/{id}/history` | owner | event, correlation_id, created_at; no Telegram address |
| POST `/trusted-contacts/simulator/update` | simulator, fake only | `{kind,start/consent/revoke/ack/suspect,chat_id,reference,message_id?}` → resource_id,state |

Simulator `kind` is one string, not an object: `{"kind":"start","chat_id":123,
"reference":"<invitation token>"}`. Other references are resource UUIDs; ack/suspect
require the exact delivered message ID. In actual Telegram mode callbacks originate
from polling, never from the browser. The fake message ID is deterministic from the
notification UUID for repeatable offline tests (see FakeTelegramAdapter).

401: missing/invalid/expired capability. 403: wrong role/callback. 404: missing or
foreign resource. 409: missing consent, expired invitation or inactive cooling.
422: invalid body. 429: rate limit (Retry-After). 503: disabled/dependency unavailable.

Frontend handoff: show CONTACT_NOT_CONFIGURED with an optional setup action, pending
consent separately from verified. Only offer notify for the existing `cooling_off`
response. Display delivery failure/expiry as advisory, never as payment approval or
rejection. Existing `resolve-cooling` remains the sole core questionnaire route.
Do not store owner capabilities or invitations in analytics or browser logs.

## Synthetic external checks (PR B)

`POST /external-checks` requires owner role and a UUID `Idempotency-Key` header.
Body: `{"identifier":"SYN-CLEAR-001","transaction_id":null}`. A transaction may
be associated only by its owner. `GET /external-checks/{id}` permits owner or SOC.
The response includes `id`, `correlation_id`, `transaction_id`, `fresh`, `cache_hit`,
and `result` with source MOCK, synthetic identifier, status CLEAR/INDICATORS/UNKNOWN/
UNAVAILABLE, markers, checked_at, expires_at, verified, error_code and advisory_only.

Display source MOCK and freshness beside the result. CLEAR does not authorize a
transfer; INDICATORS does not prove fraud. UNKNOWN/UNAVAILABLE require explicit
display. Expired evidence has `fresh:false`; never present it as current. A 409
`external_check_in_progress` permits retry with the same key; a 409
`idempotency_key_payload_conflict` requires correcting the caller's request.

## Orchestration (PR C)

POST `/integrations/transactions/{id}` accepts contact_id and/or gateway_identifier,
requires owner capability + Idempotency-Key, and returns 202 without calling adapters.
GET the same path polls the run. SOC uses GET `/integrations/soc/transactions/{id}`;
GET `/integrations/health` reports dependencies. See [handoff](ORCHESTRATION_HANDOFF.md)
for state, replay, failure, role and UI rules. All request/response models appear in
the generated OpenAPI, including enums and UUID/date-time constraints.

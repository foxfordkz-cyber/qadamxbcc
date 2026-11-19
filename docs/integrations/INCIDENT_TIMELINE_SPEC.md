# Incident Timeline — SOC contract

GET /api/v1/integrations/soc/transactions/{transaction_id}/timeline

Read-only projection of persisted Transaction facts and IntegrationAudit rows joined
through notification/check/run resources belonging to that transaction and owner.
No events are written or copied into a second audit store. Existing scoring, financial
decisions and core routes are unchanged. Dependencies: PR #1 → #2 → #3.

## Access and pagination

Signed, unexpired SOC capability required. Owner/simulator: 403; missing/invalid
credential: 401; nonexistent transaction: 404. Existing Redis principal rate limiting
and fail-closed behavior remain in effect. Responses use Cache-Control: no-store.

limit: integer 1–100, default 50. Optional cursor: at most 1024 characters.
Cursor is HMAC-signed, bound to the transaction and a 15-minute read window.
Tampering, another transaction or expiry: 422 invalid_or_expired_timeline_cursor.
Cursor carries the last timestamp/stable ID and the initial as_of cutoff. SQL limits
audit rows before materialization; stable IDs order equal timestamps without duplicates.
Events committed later with an earlier application timestamp are not a strict database
snapshot guarantee; refresh from the first page for newly committed history.

## Typed response

TimelinePage: transaction_id, as_of, events[], nullable next_cursor, advisory_only=true.
TimelineEvent: stable id, timestamp, category, importance, code, nullable correlation_id,
description_ru, description_kk, source. Categories: core/contact/gateway/orchestration.
Importance: information or attention, fixed by saved event type; no invented score.
Source: persisted_core or integration_audit. Core projections have no invented correlation.

Core projections: transfer evaluated, initial decision, cooling started when a persisted
cooling_until exists, and cooling resolved at persisted resolved_at. After resolution,
the historical initial cooling decision is retained rather than relabeled as the final
approved/blocked result. Detailed risk reasons remain in the existing core SOC contract.
The labels identify projections, not additional independently recorded core audit events.

Integration events: queued/sent/acknowledged/suspicion, retry/expiry/revoke/failure,
MOCK gateway requested/result, orchestration queued/started/complete/degraded/failed.
Unknown audit codes receive a neutral fixed label; raw event text is never echoed.
No chat address, token, amount, bank identifier or provider diagnostics are exposed.

## Validation and frontend

Executable examples and OpenAPI are in api_examples.json / openapi.json; RU/KK labels
are in ui_texts.json. The client follows next_cursor until null and refreshes from the
first page for new activity. A suspicion is advisory and cannot authorize funds.
Tests cover SOC authorization, cursor tampering/binding, bounds, tied timestamps,
cutoff behavior, unknown-code redaction, idempotent source history and core resolution.
The authorized live session also read actual Telegram acknowledgment/suspicion via
this endpoint. See TELEGRAM_LIVE_ACCEPTANCE.md and final verification.

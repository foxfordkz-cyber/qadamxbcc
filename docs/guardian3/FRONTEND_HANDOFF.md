# Guardian 3 API handoff for Damir and SOC/frontend

Continue using `frontend/src/lib/contracts.ts::api<T>` and the existing fetch transport.
No parallel client package or frontend edits are introduced. The generated OpenAPI 3.1
schemas/discriminated action union in `docs/integrations/openapi.json` are the typed source
contract; `api_examples.json` contains request/response fixtures checked against real routes.
Regenerate with `uv run python -m scripts.export_case_contracts`.
RU/KK event, question and state labels are in the existing `ui_texts.json`.
Do not present RESOLVED as recovered funds; use its explicit demo label.

All paths below start `/api/v1/integrations/guardian`. Operator-issued short-lived capabilities
are passed as Bearer tokens. Never put the signing key in the browser. SOC capabilities grant
demo SOC visibility; owner capabilities have exact source ownership. No production IAM claim.

| Method and path | Role; request | Response / UI action | Acceptance |
|---|---|---|---|
| POST /soc/cases | soc; OpenCase + Idempotency-Key | 201 CaseOut; open from report | one case/source, replay stable |
| GET /soc/cases | soc; limit 1–100, cursor | CasePage; case list | signed actor-scoped cursor, no duplicates |
| GET /soc/cases/analytics | soc | CaseAnalytics; workload counters | retained data only, no accuracy claims |
| GET /soc/cases/{case_id} | soc | CaseOut; detail header | current version/status_since/expiry |
| POST /soc/cases/{case_id}/actions | soc; Action + Idempotency-Key | CaseOut; assign/category/note/status/question | stale version 409; no automatic overwrite |
| GET /soc/cases/{case_id}/history | soc; after_version, limit | EventPage; action timeline | immutable increasing versions, bilingual text |
| GET /soc/cases/{case_id}/notes | soc; after_version, limit | ContentPage; internal notes/replies | expired text hidden even before cleanup |
| GET /soc/cases/{case_id}/evidence | soc | EvidenceOut; saved report events | no duplicate audit; use existing transaction timeline if transaction_id exists |
| GET /soc/cases/{case_id}/export | soc | CaseExport; synthetic JSON download | no IDs, aliases, notes or delivery addresses |
| GET /reports/{report_id}/information-requests | owner | InformationOut[]; own pending questions | foreign/contact-authored source 404 |
| POST /reports/{report_id}/information-requests/{request_id} | owner; AnswerInformation + Idempotency-Key | AnswerReceipt; explicit reply | one answer/request; no SOC state change |

Examples for every operation are in the existing JSON fixture bundle. For the actions union:

```json
{"action":"transition","expected_version":2,"state":"IN_REVIEW","reason":"review_started"}
```

Other variants: `assign` + assignee (demo_analyst_a/demo_analyst_b/null), `categorize` + existing
report category, `note` + body, `request_information` + question (caller_request/remote_access/
secrecy_pressure). Every variant requires expected_version. Text is synthetic, 10–500 chars.
Answer requires body and confirmed_demo_submission=true. Reopening CLOSED requires reason=reopened.

## Errors and retries

Integration errors return `{ "detail": "stable_code" }`; current frontend ApiError maps detail
to generic categories. Frontend owner should decide whether to preserve safe detail codes in
the existing helper before wiring field-level messages. No competing transport was added.

| HTTP | Codes / handling |
|---|---|
| 400 | case_cursor_invalid: restart pagination |
| 401 / 403 | missing/expired capability or wrong role: authenticate; do not retry blindly |
| 404 | case_not_found, incident_not_found, case_information_not_found: no resource/ownership |
| 409 | case_version_conflict: reload, reconcile and explicitly submit with a fresh key |
| 409 | case_idempotency_conflict, case_write_conflict, case_already_exists: inspect current data |
| 409 | case_transition_not_permitted, case_reopen_reason_required, case_reopen_required: correct UI action |
| 409 | case_information_channel_unavailable, case_information_pending, case_information_already_answered, case_information_closed: show fixed explanation; never switch recipient |
| 409 | case_action_limit: inspect/export before retention; no more writes |
| 410 | case_expired, incident_expired: remove content from view |
| 422 | case_input_invalid: fixed message, no rejected secret echoed |
| 429 | integration rate limit; respect Retry-After |
| 503 | disabled integrations / unavailable rate limiter: show dependency state |

On unknown HTTP mutation outcome retry only the exact same body/key as the original request.
Preserve the key until the outcome is known. No automatic state-conflict overwrite.
List pages use next_cursor; histories/notes use next_after_version. Stop when null.
Case list reflects current retention, not a frozen snapshot; expired items can disappear.

## Four synthetic flows for joint acceptance

1. Existing approved preset: no case/notification side effect, original decision unchanged.
2. Cooling-Off + consenting selected contact: existing advisory/SOC summary; explicit report,
   open case, assign, IN_REVIEW, ask via owner API, answer, resolve/close/reopen.
3. Existing suspicious-network preset: MOCK evidence and existing timeline, no real NBK call.
4. Two SOC tabs edit one version: one succeeds, other gets 409; repeat same-key request gives
   original receipt; owner cannot inspect notes, change SOC state or read a contact report.

Frontend work remaining: connect screens to existing transport, obtain capabilities from the
demo operator, confirm role-specific navigation, bilingual labels and joint case/expiry UX.
This handoff is published for review; it does not imply teammates have accepted it.

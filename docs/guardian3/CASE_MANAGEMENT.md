# Guardian 3 synthetic SOC cases

Base: audited PR #7 `5c5843c`. Migration `0007_guardian_cases` follows `0006_guardian_reports`.
Three integration-owned tables: case, append-only action events, separately expiring content.
No changes to core scoring, financial decisions, frontend UI or live Telegram.

## Operator workflow

SOC opens one case per existing unexpired Guardian report; reviews its saved report events and,
where available, the existing transaction timeline/summary. Category, assignment to
`demo_analyst_a` / `demo_analyst_b`, internal notes and state changes are explicitly authorized
SOC operations. Demo capabilities do not constitute bank IAM or real employee identities.

Allowed transitions:

| From | To |
|---|---|
| NEW | IN_REVIEW, ESCALATED, CLOSED |
| IN_REVIEW | ESCALATED, RESOLVED, CLOSED |
| NEEDS_INFORMATION | IN_REVIEW, ESCALATED, CLOSED |
| ESCALATED | IN_REVIEW, RESOLVED, CLOSED |
| RESOLVED | IN_REVIEW, CLOSED |
| CLOSED | IN_REVIEW, with reason `reopened` |

NEEDS_INFORMATION is entered only by `request_information` from IN_REVIEW or ESCALATED.
Only one unanswered question may exist. The allowed channel is the authenticated owner demo
API for owner-authored reports. Contact-authored reports return
`case_information_channel_unavailable`; they must not be routed to the bank account owner.
Nothing is sent to Telegram, a bank or third party. Owner replies require explicit confirmation
and do not change SOC state. CLOSED/RESOLVED must be reopened before other edits.
RESOLVED means completion of this synthetic review, never a refund or crime finding.

## Consistency and privacy

Every mutation locks the case and compares `expected_version`. Stale writes return 409.
An identical replay with the same UUID Idempotency-Key and actor returns the original snapshot;
changed payload/actor returns 409. A case retains at most 500 actions. Opening is serialized by
the source report row. Locks and unique constraints are tested on PostgreSQL; SQLite is the
portable functional suite, not evidence of row-lock semantics.

Audit events are append-only through this API, with monotonically increasing versions and no
edit/delete endpoint. Privileged database administrators remain trusted; this is not a cryptographic
tamper-proof log. Event metadata holds an actor UUID and original result, never free-text notes.
Notes and replies expire after seven days (or earlier case expiry), hidden immediately on reads.
Case metadata/events expire 30 days after opening, even if review is unfinished; UI must display
`expires_at`. The worker purges at most 100 expired content rows and 100 cases per minute.
Retention purge is the documented exception to audit immutability. Backups require an operator
retention policy before any production use. Original report retention stays independent.

Free text uses existing conservative minimization (10–500 characters, no controls, URL, @,
four-digit sequences or common secret words). This cannot guarantee arbitrary prose has no PII;
use synthetic descriptions only. Validation errors do not echo rejected inputs.
Content and exports have Cache-Control: no-store. Export includes only fixed categories,
states, source class, timestamps and event codes: no UUIDs, names, notes, chat IDs or addresses.
Timestamps may still correlate synthetic scenarios; this is not a general anonymization claim.

## Analytics

Counts cover unexpired cases. Open = all except CLOSED (including RESOLVED awaiting closure).
Escalations count distinct cases ever in ESCALATED, not repeated clicks. Manual-review share =
cases ever IN_REVIEW/NEEDS_INFORMATION/ESCALATED/RESOLVED divided by all retained cases.
Current-state duration is derived from status_since, not the last note/assignment timestamp.
Queries use SQL aggregates; they do not load every audit payload into application memory.
These are workload facts, not detection accuracy or money saved.

## Reproduction and acceptance

`uv run pytest tests/integrations/test_guardian_cases.py` covers roles, state matrix,
idempotency, optimistic versions, source isolation, retained evidence, pagination and expiry.
Set BCC_TEST_DATABASE_URL to a disposable `bcc_integration_test*` PostgreSQL DB and
BCC_TEST_REDIS_URL to Redis DB 15 for actual concurrent row-lock tests.
`uv run python -m scripts.verify_case_migrations` verifies upgrade/downgrade/ORM parity on that
disposable database only. `uv run python -m scripts.demo_cases` runs the existing three presets,
Guardian submission and a SOC case lifecycle against a fresh localhost fake Compose stack.
It deliberately waits for the rate-limit window between suites. Never point it at production.

Owner review must cover migration retention, integration permissions and UI meanings.
Team frontend acceptance and owner merge approval remain outstanding.

## Local pre-publication evidence (15 November 2026)

Ruff check/format and strict mypy (122 sources) passed. PostgreSQL/Redis focused suite: 49
passes, including all 15 case tests and 34 contract tests. PostgreSQL migration round trip
and ORM parity passed. Portable full suite initially had 248 passes, 11 external-only skips
and one OpenAPI parity failure: the schema export was refreshed while that process held an
older imported schema. The standalone contract rerun and exact-head CI are tracked in the PR.
Legacy OpenAPI paths and component schemas compared equal to PR #7; core/frontend diff empty.

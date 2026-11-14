# Bekzat — integrations contribution ledger

Owner: Bekzat, Integrations & External APIs Lead. This implementation is AI-assisted
with Codex under Bekzat's instructions; it is not represented as solely handwritten.
Commits use the configured Bekzat identity matching the connected GitHub account.
Initial audit: `627fa88`. Attribution baseline for this ledger:
`a02d20dcc857001de364e0b0f12a66ce72db0c12` (current main with Damir's changes).
Inherited core, hybrid ML, biometrics, frontend and core benchmark code are excluded.

## Implemented modules and engineering problems

| Block | Implementation | Problems addressed |
|---|---|---|
| A | `app/integrations/telegram/`, trusted-contact API, shared config/security/audit/models, token CLI, migration 0002 | Owner and recipient consent; single-use binding; account/role isolation; durable deduplication; callback authentication; revocation/delivery ordering; conservative crash ambiguity; RU/KK private messages |
| B | `app/integrations/nbk_mock/`, external-check API, migration 0003 | Typed synthetic protocol; validated freshness; bounded timeout/retry; safe UNKNOWN/UNAVAILABLE; Redis cache; concurrent idempotency; sanitized audit |
| C | Orchestrator, durable run model, worker, observability/contracts, integration API, migration 0004, Docker overlay/demo/CI | External I/O outside scoring; durable recovery; correlation; safe SOC evidence; dependency health; full-stack fake E2E; core foreign-key lock compatibility |

Minimal hooks in two existing Python files (`app/main.py` and `app/models/__init__.py`)
register the new model modules, API routers and domain error handler. Existing services,
schemas, transfer routes, core entities, Docker base Compose and frontend have no
authored behavior changes. Shared hooks/migrations still require core-owner review.

## Created API operations

All paths below begin `/api/v1`. The typed source of truth is `/openapi.json`.

| Methods | Path | Access |
|---|---|---|
| POST, GET | `/trusted-contacts` | Owner |
| DELETE | `/trusted-contacts/{contact_id}` | Owner |
| POST, GET | `/trusted-contacts/transactions/{transaction_id}/notifications` | Owner |
| GET | `/trusted-contacts/notifications/{notification_id}/history` | Owner |
| POST | `/trusted-contacts/simulator/update` | Simulator role; fake mode only |
| POST | `/external-checks` | Owner; UUID Idempotency-Key |
| GET | `/external-checks/{check_id}` | Owner or SOC |
| POST, GET | `/integrations/transactions/{transaction_id}` | Owner; POST requires UUID Idempotency-Key |
| GET | `/integrations/soc/transactions/{transaction_id}` | SOC |
| GET | `/integrations/health` | SOC |

Total: 10 new paths, 13 operations. Existing current-main paths and component schemas
are preserved. Full role/error/state/UI rules are in [API contracts](INTEGRATION_API_CONTRACTS.md)
and the complete [frontend handoff](BEKZAT_FRONTEND_HANDOFF.md).

## Tests and verification (2026-11-14)

123 integration cases, including 35 added during this final audit and six live-only
PostgreSQL cases. The two old C regressions backported into A are not counted again.
Final source CI e23df31: 165 backend passed/6 live-only skipped in verify.sh, then
123 integration passed with PostgreSQL/Redis. This is 171 unique backend cases =
48 existing core + 123 integration. All 12 existing frontend tests, TypeScript,
Next.js build, Ruff, strict mypy and Compose checks pass. Frontend tests are inherited.
All three synthetic full-stack demos and the migration roundtrip pass.
See [verification](BEKZAT_FINAL_VERIFICATION.md) for precise local/CI distinctions,
latency results, before/after failures and limitations; reruns are not added together.

## Published Draft PRs and commits

| PR | Branch | Base / review order |
|---|---|---|
| [A #1](https://github.com/foxfordkz-cyber/qadamxbcc/pull/1) | feature/bekzat-trusted-contact | main; first |
| [B #2](https://github.com/foxfordkz-cyber/qadamxbcc/pull/2) | feature/bekzat-nbk-mock-gateway | A; second |
| [C #3](https://github.com/foxfordkz-cyber/qadamxbcc/pull/3) | feature/bekzat-integration-orchestrator | B; third |

All remain open, Draft, unmerged. No owner review is claimed. The owner controls
merging and subsequent retargeting; no force push or main merge was performed.
Original implementation: 5a755f8 (A), 61a34d6 (B), dddbd9c (C), 179b0ca (worker/demo fixes).
Original documentation c905b68 is the starting point of this audit.

Final audit commits:

- e7fdd17: bounded explicit-rejection retry, sanitized polling, consent/FK-lock backports.
- 20e62cf: bilingual gateway descriptions and synthetic network fixture.
- a177120: clear current run error on successful recovery, preserve audit history.
- cb63483: three actual demo flows, outbox regression, typed examples/OpenAPI/UI vocabulary.
- 444da14 and e23df31: mask ephemeral CI demo key before export; behavioral regression.
- Documentation-only completion commit: current PR #3 head (its hash cannot be embedded in itself).

Stack merges 71b1c3a/24e095a propagate fixes; they are not separate authored features.
Damir's a02d20d and existing core/ML/biometrics/frontend work are inherited, not attributed here.

## Measured source change

Baseline a02d20dcc857001de364e0b0f12a66ce72db0c12. Method: git diff --numstat,
grouped by purpose. Python textual count excludes blanks and comment-only lines
starting with #; it includes strings/docstrings, is not AST complexity or a quality score.
AI assistance is disclosed above. Generated exports and lockfiles are separate.

| Category | Files | Added lines | Removed lines | Net |
|---|---:|---:|---:|---:|
| Configuration/CI/Docker | 7 | 127 | 1 | 126 |
| Python implementation/scripts/migrations | 41 | 2523 | 2 | 2521 |
| Python tests/fixtures | 13 | 1623 | 0 | 1623 |
| Generated dependency lockfile | 1 | 735 | 105 | 630 |
| Documentation | 12 | 1222 | 0 | 1222 |
| Generated OpenAPI/examples/UI vocabulary/readiness JSON | 4 | 4334 | 0 | 4334 |

Total changed files: 78. Net Python lines excluding blanks/comment-only
lines: implementation 2195, tests 1397, combined 3592.
These counts include the integration scope across A/B/C, not only this audit's fixes.

## Exact changed-file manifest

- `.env.example`
- `.github/workflows/integrations.yml`
- `.gitignore`
- `backend/.dockerignore`
- `backend/alembic/versions/0002_trusted_contacts.py`
- `backend/alembic/versions/0003_external_checks.py`
- `backend/alembic/versions/0004_integration_runs.py`
- `backend/app/api/v1/external_checks.py`
- `backend/app/api/v1/integrations.py`
- `backend/app/api/v1/trusted_contacts.py`
- `backend/app/integrations/__init__.py`
- `backend/app/integrations/audit.py`
- `backend/app/integrations/config.py`
- `backend/app/integrations/contracts.py`
- `backend/app/integrations/errors.py`
- `backend/app/integrations/models.py`
- `backend/app/integrations/nbk_mock/__init__.py`
- `backend/app/integrations/nbk_mock/adapter.py`
- `backend/app/integrations/nbk_mock/audit.py`
- `backend/app/integrations/nbk_mock/client.py`
- `backend/app/integrations/nbk_mock/errors.py`
- `backend/app/integrations/nbk_mock/fixtures.py`
- `backend/app/integrations/nbk_mock/localization.py`
- `backend/app/integrations/nbk_mock/models.py`
- `backend/app/integrations/nbk_mock/schemas.py`
- `backend/app/integrations/nbk_mock/service.py`
- `backend/app/integrations/nbk_mock/validator.py`
- `backend/app/integrations/observability.py`
- `backend/app/integrations/orchestrator.py`
- `backend/app/integrations/run_model.py`
- `backend/app/integrations/security.py`
- `backend/app/integrations/telegram/__init__.py`
- `backend/app/integrations/telegram/adapter.py`
- `backend/app/integrations/telegram/bot.py`
- `backend/app/integrations/telegram/fake_adapter.py`
- `backend/app/integrations/telegram/handlers.py`
- `backend/app/integrations/telegram/schemas.py`
- `backend/app/integrations/telegram/service.py`
- `backend/app/integrations/telegram/templates.py`
- `backend/app/integrations/telegram/worker.py`
- `backend/app/integrations/worker.py`
- `backend/app/main.py`
- `backend/app/models/__init__.py`
- `backend/pyproject.toml`
- `backend/scripts/demo_integrations.py`
- `backend/scripts/integration_token.py`
- `backend/tests/integrations/__init__.py`
- `backend/tests/integrations/conftest.py`
- `backend/tests/integrations/test_ci_secret_masking.py`
- `backend/tests/integrations/test_delivery_recovery.py`
- `backend/tests/integrations/test_final_recovery.py`
- `backend/tests/integrations/test_gateway_localization.py`
- `backend/tests/integrations/test_handoff_contracts.py`
- `backend/tests/integrations/test_live_persistence.py`
- `backend/tests/integrations/test_nbk_gateway.py`
- `backend/tests/integrations/test_orchestration.py`
- `backend/tests/integrations/test_telegram_adapter.py`
- `backend/tests/integrations/test_telegram_security.py`
- `backend/tests/integrations/test_trusted_contacts.py`
- `backend/uv.lock`
- `docker-compose.integrations.yml`
- `docs/integrations/BEKZAT_90_PERCENT_AUDIT.md`
- `docs/integrations/BEKZAT_CONTRIBUTIONS.md`
- `docs/integrations/BEKZAT_DEMO_GUIDE.md`
- `docs/integrations/BEKZAT_FINAL_VERIFICATION.md`
- `docs/integrations/BEKZAT_FRONTEND_HANDOFF.md`
- `docs/integrations/INTEGRATION_API_CONTRACTS.md`
- `docs/integrations/INTEGRATION_SECURITY.md`
- `docs/integrations/INTEGRATION_TEST_REPORT.md`
- `docs/integrations/NBK_MOCK_GATEWAY.md`
- `docs/integrations/ORCHESTRATION_HANDOFF.md`
- `docs/integrations/TELEGRAM_BOT_SETUP.md`
- `docs/integrations/TRUSTED_CONTACT_ARCHITECTURE.md`
- `docs/integrations/api_examples.json`
- `docs/integrations/openapi.json`
- `docs/integrations/readiness_matrix.json`
- `docs/integrations/ui_texts.json`
- `verify.sh`

## Handoff and remaining limits

The [100-row audit](BEKZAT_90_PERCENT_AUDIT.md) records 96 DONE, 1 PARTIAL and
3 BLOCKED, weighted readiness 97.25%. Long Telegram retry delays remain partial;
authorized real Telegram delivery, human core review and joint frontend acceptance
remain blocked. Mock delivery does not prove real Telegram. No UI was rewritten.
Contact signals are advisory; they cannot authorize funds. All gateway evidence is MOCK.

Local fake demo: GO. Feature/test team integration: GO; merge/UI acceptance await
human review. Production: NO-GO. No production deployment, real bank/NBK calls,
unauthorized messages or existing-secret changes were performed.

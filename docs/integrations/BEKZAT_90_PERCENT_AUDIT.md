# Bekzat — доказательный аудит готовности (2026-11-14)

**99,50% по прежней матрице: 98 DONE, 0 PARTIAL, 2 BLOCKED, 0 MISSING.**
Все 100 исходных строк и веса сохранены; новые Timeline/Health не увеличивают оценку.
До этого этапа: 97,25%, 96 DONE, T10 PARTIAL, T09/D17/D18 BLOCKED; 171 backend cases.
T09 закрыт фактической разрешённой Telegram-приёмкой, T10 — durable Retry-After.
D17 (human core-owner review) и D18 (совместная frontend/UI-приёмка) остаются BLOCKED.

DONE=1, PARTIAL=0.5, BLOCKED/MISSING=0. Итог: сумма(weight × earned / 20).
T=30%, G=25%, O=25%, S=15%, D=5%; N/A=0. Это оценка согласованной интеграционной
области, не production readiness или вероятность отсутствия ошибок.

| Группа | Вес | Баллы | Вклад |
|---|---:|---:|---:|
| T | 30% | 20/20 | 30.00% |
| G | 25% | 20/20 | 25.00% |
| O | 25% | 20/20 | 25.00% |
| S | 15% | 20/20 | 15.00% |
| D | 5% | 18/20 | 4.50% |

Core baseline: `a02d20dcc857001de364e0b0f12a66ce72db0c12`.
Implementation: PR #1 `59550de`, #2 `be7489d`, #3 `4533b16`, #4 `84c7930`.
Точные CI, тесты, Docker, migrations и latency: [final verification](BEKZAT_FINAL_VERIFICATION.md).
Live evidence: [Telegram acceptance](TELEGRAM_LIVE_ACCEPTANCE.md). Никаких реальных
банковских операций, НБК, production deployment или изменения чужого frontend/scoring.

## Исходные 100 требований

| ID | Требование | Статус | Реализация / evidence | Проверка | Остаток | Приоритет |
|---|---|---|---|---|---|---|
| T01 | Регистрация доверенного контакта | DONE | telegram/service.py: invite, owner consent, quota | test_owner_consent_required; test_no_contact | — | P1 |
| T02 | Безопасная привязка Telegram | DONE | 256-bit одноразовый hash-token + private sender | test_one_time_invite_and_contact_consent; test_concurrent_invitation_consumption | — | P1 |
| T03 | Отдельное согласие получателя | DONE | bind не делает VERIFIED; consent отдельно | test_wrong_contact_cannot_consent; test_one_time_invite_and_contact_consent | — | P1 |
| T04 | Отзыв обоими участниками | DONE | revoke, очистка адреса, отмена queued | test_revoked_consent_prevents_future_notifications; test_stale_session_observes_consent_revocation | — | P1 |
| T05 | Хранение статусов | DONE | trusted_contacts + contact_notifications | test_verified_duplicate_notification_and_audit | — | P1 |
| T06 | RU/KZ сообщения | DONE | telegram/templates.py, ru/kk | test_templates_do_not_leak_financial_data[ru/kk] | — | P1 |
| T07 | Создание уведомления для своего active cooling | DONE | service.enqueue, existing cooling_until | test_approved_transfer_not_queued; test_delivery_guards | — | P1 |
| T08 | FakeTelegramAdapter | DONE | telegram/fake_adapter.py, default fake | test_fake_adapter_idempotency; fake Docker E2E | — | P1 |
| T09 | Реальная доставка в разрешённой тестовой среде | DONE | Authorized live RU/KK alerts, 11 accepted messages; TELEGRAM_LIVE_ACCEPTANCE.md | Real private-chat consent/decline/revoke, suspicion and acknowledgment callbacks, SOC reload | — | P1 |
| T10 | Повтор при временном отказе | DONE | Persisted next_attempt_at and max 3 claims; explicit rejection only; migration 0002a | test_durable_retry + concurrent due-claim PostgreSQL regression | — | P2 |
| T11 | Защита от повторной отправки | DONE | unique contact+tx; durable claim; uncertain terminal | test_concurrent_enqueue_is_unique; test_crash_claim_is_never_retried | — | P1 |
| T12 | Idempotency уведомлений и callbacks | DONE | canonical row; monotonic advisory states | test_callbacks_are_advisory_monotonic_and_idempotent | — | P1 |
| T13 | Notification expiry | DONE | core cooling deadline + recheck before retry | test_expired_invite; test_delivery_guards; test_callback_authentication | — | P1 |
| T14 | Валидация callbacks | DONE | sender/chat/message/ref/state/expiry | test_callback_authentication; test_owner_cannot_impersonate_telegram_sender | — | P1 |
| T15 | Защита персональных данных | DONE | адрес только внутри БД до revoke; минимальные тексты | test_templates_do_not_leak_financial_data; test_e2e_cooling_consent_delivery_suspicion_and_soc | — | P1 |
| T16 | Audit events | DONE | integration_audit + correlation + NOTIFICATION_RETRY | test_verified_duplicate_notification_and_audit; test_rejected_send_retries_once_without_duplicate | — | P1 |
| T17 | Error handling Telegram и ingress | DONE | worker isolation + sanitized router error boundary | test_polling_boundary_does_not_leak_or_crash; test_real_adapter_error_is_sanitized | — | P1 |
| T18 | Совместимость с Cooling-Off, advisory only | DONE | нет вызова resolve-cooling; core unchanged | test_e2e_cooling_consent_delivery_suspicion_and_soc; DEMO scam | — | P1 |
| T19 | Telegram architecture/setup/security docs | DONE | TRUSTED_CONTACT_ARCHITECTURE.md; TELEGRAM_BOT_SETUP.md | document review + linked API fixtures | — | P1 |
| T20 | Telegram integration tests | DONE | 57 cases на самостоятельном PR A | PostgreSQL/Redis 57 passed + A CI | — | P1 |
| G01 | Typed external protocol | DONE | ExternalGatewayProtocol.lookup | strict mypy; test_typed_synthetic_results | — | P1 |
| G02 | Mock adapter | DONE | MockGatewayAdapter, in-process only | test_typed_synthetic_results | — | P1 |
| G03 | Synthetic fixtures | DONE | SYN-CLEAR / REVIEW / NETWORK; unknown explicit | test_gateway_exposes_bilingual_evidence | — | P1 |
| G04 | Request validation | DONE | SYN-* constrained string, UUID ownership | test_non_synthetic_identifiers_rejected; test_foreign_transaction_rejected | — | P1 |
| G05 | Response validation | DONE | extra forbid, source/identity/verified/interval | test_failure_classification | — | P1 |
| G06 | Redis cache | DONE | hashed versioned keys, safe bounded cache I/O | test_cache_and_expired_cache | — | P1 |
| G07 | Cache expiry/freshness | DONE | TTL <=60s/provider expiry; revalidate each hit | test_idempotent_replay_does_not_freshen_expired_result; test_corrupt_cache_is_not_trusted | — | P1 |
| G08 | Timeout | DONE | GatewayClient per-attempt timeout | test_failure_classification[timeout] | — | P1 |
| G09 | Bounded retry policy | DONE | max 2 read-only transient attempts, backoff | test_bounded_transient_retry | — | P1 |
| G10 | UNKNOWN/UNAVAILABLE | DONE | GatewayStatus enum and fixed errors | test_failure_classification; test_incomplete_reservation_is_explicit | — | P1 |
| G11 | Safe fallback без денежного решения | DONE | unknown() + no core mutation | test_enrichment_never_changes_transfer; test_cache_failure_degrades_safely | — | P1 |
| G12 | Audit logging | DONE | GatewayAuditService + requested/completed | test_idempotency_and_payload_binding | — | P1 |
| G13 | Idempotency | DONE | owner+key durable reservation, payload conflict | test_concurrent_gateway_reservation | — | P1 |
| G14 | RU/KZ descriptions | DONE | description_ru / description_kk computed from enums | 11 test_gateway_localization cases | — | P1 |
| G15 | API documentation | DONE | NBK_MOCK_GATEWAY.md; OpenAPI; examples | test_frontend_examples_match_published_routes | — | P1 |
| G16 | Contract tests | DONE | typed fixtures, malformed/unverified/future replies | test_typed_synthetic_results; test_failure_classification | — | P1 |
| G17 | Security tests | DONE | owner/SOC boundaries, synthetic-only identifiers | test_owner_and_soc_visibility; test_foreign_transaction_rejected | — | P1 |
| G18 | SOC integration | DONE | ExternalCheckOut in EnrichmentOut, freshness exposed | test_e2e_cooling_consent_delivery_suspicion_and_soc; DEMO hub | — | P1 |
| G19 | Docker compatibility | DONE | worker uses in-process mock without provider keys | compose-demo CI + local five-service smoke | — | P1 |
| G20 | Error handling | DONE | fixed codes, no provider diagnostic leakage | test_gateway_errors_have_safe_bilingual_descriptions | — | P1 |
| O01 | Durable event processing | DONE | integration_runs persisted before processing | test_duplicate_events_and_payload_conflicts; test_worker_restart_replays_safely | — | P1 |
| O02 | Background worker | DONE | separate app.integrations.worker process | Docker heartbeat + E2E | — | P1 |
| O03 | Transactional outbox integration intent | DONE | job+audit same DB commit; optional POST after evaluate | test_outbox_and_audit_rollback_together_on_commit_failure | — | P1 |
| O04 | Event correlation | DONE | run/notification/check/audit IDs linked | test_e2e_cooling_consent_delivery_suspicion_and_soc | — | P1 |
| O05 | Retry/recovery | DONE | 3 bounded attempts; stale current error cleared | test_worker_retries_are_bounded; test_recovered_run_clears_current_error_but_preserves_audit | — | P1 |
| O06 | Duplicate event prevention | DONE | unique transaction and owner+idempotency key | test_concurrent_orchestration_is_unique | — | P1 |
| O07 | Transaction isolation | DONE | locks confined to integration lifecycle; no core lock over provider I/O | test_invitation_lock_does_not_block_core_foreign_keys; test_stale_session_observes_consent_revocation | — | P1 |
| O08 | Failure recovery | DONE | stale claim handling, bounded retry, visible failure | test_worker_restart_replays_safely; test_worker_retries_are_bounded | — | P1 |
| O09 | Telegram orchestration | DONE | consent-gated enqueue, separate delivery | test_contact_gates_in_orchestration | — | P1 |
| O10 | Gateway orchestration | DONE | optional enrichment, independent of scoring | test_gateway_failure_does_not_prevent_contact_or_scoring | — | P1 |
| O11 | SOC evidence | DONE | advisory evidence, safe events, unchanged core_status | test_delivery_failure_remains_visible_to_soc; DEMO hub | — | P1 |
| O12 | Structured logs | DONE | SafeJSONFormatter allowlist | test_structured_logs_allowlist_fields | — | P1 |
| O13 | Dependency health | DONE | bounded DB/Redis probe + worker heartbeat | test_dependency_health; test_limiter_failure_is_closed | — | P1 |
| O14 | Docker | DONE | optional overlay, no token for base/fake | full verify Compose config + compose-demo CI | — | P1 |
| O15 | PostgreSQL | DONE | durable jobs/audit/checks/contact lifecycle | live PostgreSQL integration suite | — | P1 |
| O16 | Redis | DONE | rate limit, gateway cache, heartbeat | real Redis DB15 tests | — | P1 |
| O17 | Integration API | DONE | 15 operations total; owner/SOC/simulator separation | test_soc_requires_soc_role_and_owner_is_scoped; API examples tests | — | P1 |
| O18 | E2E | DONE | normal, scam, hub script through full stack | scripts.demo_integrations local + CI | — | P1 |
| O19 | No scoring modification | DONE | services/schemas/core transfer routes no diff from a02d20d | existing core suite + test_scoring_and_enqueue_never_call_gateway | — | P1 |
| O20 | No frontend regression | DONE | frontend untouched | 12 existing frontend tests + tsc + Next build | — | P1 |
| S01 | Account-bound authorization; UUID alone insufficient | DONE | security.py HMAC role/subject/expiry | test_missing_auth_and_fake_identity; test_cross_owner_access | — | P1 |
| S02 | Simulator isolation / real-mode guards | DONE | simulator role fake-only; test environment allowlist | test_owner_cannot_impersonate_telegram_sender; test_real_adapter_allowlist_blocks_before_network | — | P1 |
| S03 | Rate limiting and fail-closed dependency | DONE | Redis atomic per-principal counter + bot limit | test_rate_limit; test_limiter_failure_is_closed; polling redis_unavailable | — | P1 |
| S04 | No secrets in tracked code/current CI logs | DONE | known-pattern scan; safe events; CI key masked before export | test_polling_boundary_does_not_leak_or_crash; test_ci_generated_key_is_masked_before_next_step; new CI log inspection | — | P1 |
| S05 | Input validation and consistent errors | DONE | Pydantic schemas + sanitized IntegrationError | security tests + 15 request examples validation | — | P1 |
| S06 | Failure injection | DONE | timeout/unavailable/malformed/cache/provider failures | test_failure_classification; test_delivery_timeout_is_bounded | — | P1 |
| S07 | Concurrent duplicate protection in PostgreSQL | DONE | unique keys + row locks | 7 live-only concurrency/locking cases | — | P1 |
| S08 | Crash/restart semantics tested | DONE | no ambiguous resend; stale run recovery | test_crash_claim_is_never_retried; test_worker_restart_replays_safely | — | P1 |
| S09 | Revoked consent survives stale sessions | DONE | populate_existing under contact lock | test_stale_session_observes_consent_revocation | — | P1 |
| S10 | Reversible migrations and ORM parity | DONE | 0002/0003/0004; five tables | PostgreSQL head→0001→head + alembic check; existing SQLite migration test | — | P1 |
| S11 | Full oracle, lint/types/backend/frontend | DONE | verify.sh from current tree | Ruff + mypy + pytest + tsc/build + Compose | — | P1 |
| S12 | APPROVED/COOLING_OFF/BLOCKED preserved | DONE | existing core API, no financial writes from integrations | core scenario tests + three full-stack demos | — | P1 |
| S13 | Ownership boundaries | DONE | no core weights/thresholds/frontend rewrite | git diff current main; original API comparison | — | P1 |
| S14 | Existing API backward compatibility | DONE | all current-main OpenAPI paths/components equal | structural OpenAPI comparison + snapshot test | — | P1 |
| S15 | Off-path latency verified | DONE | no adapters in scoring; repeated real-Redis benchmark | 3×500 current main vs integrated measurements; no production SLA | — | P1 |
| S16 | Isolated test data and resources | DONE | bcc_integration_test DB/schema, Redis15, synthetic fixtures | fixture guards; disposable Compose project | — | P1 |
| S17 | Disabled integration leaves core operational | DONE | enabled=false default; adapters independent | test_disabled_integrations_leave_core_alive; test_disabled_gateway | — | P1 |
| S18 | No real NBK/bank data/money | DONE | no remote gateway; only SYN-* and synthetic seed | source review + demo trace + validation tests | — | P1 |
| S19 | Contact cannot authorize funds | DONE | advisory_only; no resolve-cooling invocation | test_e2e_cooling_consent_delivery_suspicion_and_soc | — | P1 |
| S20 | Operational scope guardrails | DONE | no production deploy, secret rotation, force push or main merge | Git history/PR state; reused existing local demo config | — | P1 |
| D01 | Full requirements matrix and transparent scoring | DONE | this 100-row matrix; original-spec traceability | formula recomputed from statuses, no manual target override | — | P1 |
| D02 | API inventory and generated OpenAPI JSON | DONE | BEKZAT_FRONTEND_HANDOFF.md + openapi.json | test_openapi_export_matches_current_application | — | P1 |
| D03 | Request/response examples for every operation | DONE | api_examples.json, roles/headers/statuses | 15 test_frontend_examples_match_published_routes cases | — | P1 |
| D04 | Error states and caller actions | DONE | handoff HTTP 401/403/404/409/422/429/503 table | authorization/validation/failure tests | — | P1 |
| D05 | Contact/notification/run lifecycle handoff | DONE | handoff state and expiry/replay rules | consent, callback, lifecycle tests | — | P1 |
| D06 | RU/KZ UI vocabulary | DONE | ui_texts.json + gateway computed descriptions | template tests + gateway localization coverage | — | P1 |
| D07 | SOC UI data contracts | DONE | EnrichmentOut and core feed/graph join guidance | SOC role/ownership and E2E tests | — | P1 |
| D08 | Configuration and setup | DONE | .env.example, test bot and fake Docker instructions | disabled-mode tests + Docker smoke | — | P1 |
| D09 | DEMO 1 normal transfer | DONE | core preset approved, no integration run/alert | full-stack normal PASS | — | P1 |
| D10 | DEMO 2 social engineering | DONE | cooling + consent + suspicion + SOC | full-stack scam PASS | — | P1 |
| D11 | DEMO 3 suspicious network | DONE | core blocked + graph evidence + MOCK network marker | full-stack hub PASS | — | P1 |
| D12 | Architecture/security/original documentation | DONE | original seven docs retained; current updates linked | documentation review against source | — | P1 |
| D13 | Final verification evidence with SHA/PR/commands | DONE | BEKZAT_FINAL_VERIFICATION.md | local logs + immutable CI run links | — | P1 |
| D14 | Honest contribution accounting | DONE | BEKZAT_CONTRIBUTIONS.md, current-main diff | generated JSON/lockfiles/docs separated from authored Python | — | P1 |
| D15 | Published fix commits and current PR CI | DONE | PR A/B/C, no force push | GitHub Actions on checked branch heads | — | P1 |
| D16 | Current main/reviews/mergeability audited | DONE | main a02d20d; open Draft PRs; no reviews | GitHub metadata and review timeline reads | — | P1 |
| D17 | Human core-owner review of shared hooks/migrations | BLOCKED | no owner approval submitted | agent checks are not independent human approval | Владелец core должен провести review/одобрение; агент не может одобрить собственную работу | P1 |
| D18 | Joint frontend acceptance using real UI | BLOCKED | contracts delivered; frontend implementation belongs to team | no joint mobile/SOC browser sign-off | Дамир/mobile и SOC-команда подключают UI и проводят совместный acceptance | P1 |
| D19 | Reproducible evidence and artifact package | DONE | logs, OpenAPI, examples, reports, source archive | archive integrity + checksum manifest | — | P1 |
| D20 | GO gates and remaining work declared | DONE | local/team/production decisions separated | security gate independent of percentage | — | P1 |

## Новые P1-функции и независимые границы

Incident Timeline — read-only проекция уже сохранённых core facts/audit, RU/KK,
SOC-only, подписанный cursor, pagination, корреляции, без копирования audit rows.
Integration Health — очередь/ошибки/последний успех/DB/Redis/worker/configured adapters,
кэш 5s, ограниченные probes; реальный Telegram/NBK не опрашиваются этим endpoint.
Подробные контракты: [Timeline](INCIDENT_TIMELINE_SPEC.md), [Health](INTEGRATION_HEALTH_REPORT.md).

Fake-only остаются gateway (всегда MOCK), искусственные outages/429/timeouts и
многопользовательские негативные сценарии. Реальные RU/KK delivery и callbacks
подтверждены отдельно; controlled tests не выдаются за внешнюю сертификацию.
Длительный Retry-After: сохранённая дата, максимум 3 claims, expiry/consent/core recheck,
один claim при конкуренции. Неизвестный результат отправки не повторяется.
Standalone worker восстанавливает цикл после временной DB/Redis ошибки.

Trusted Circle отложен: текущая квота — один активный контакт; расширение требует
отдельного UX/quota/priority/retention review. Массовой рассылки нет. Scam Safety
остаётся образовательным представлением существующего CoolingQuestionnaire, без
второго финансового механизма; RU/KK mapping передан frontend в handoff.

**Локальное synthetic demo: GO. Team integration: GO для feature/test подключения и
review; общий merge/UI acceptance ожидают D17/D18. Production: NO-GO.**
Владелец core должен проверить migrations/shared hooks; frontend-команда — подключить
экраны, capabilities и провести совместную приёмку. Bank IAM, provider contracts,
retention/encryption и эксплуатационный security sign-off остаются вне demo readiness.

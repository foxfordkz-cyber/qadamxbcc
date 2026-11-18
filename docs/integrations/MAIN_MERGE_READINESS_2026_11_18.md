# Bekzat — rehearsal for the team integration order

18 November 2026. This is preparation in `codex/bekzat-main-readiness-20261118`,
not completion of step 3 and not permission to merge main.

## Inputs and merge gate

- Bekzat stack: `0de50a37b911b7d37ce6395bbde41266963307e0`.
- Current main rehearsed here: `3d19e8e4fd92431e936fa68eb7728448a85b7105`.
- Redesign pending: `03cd8f32cf11bad7e5bb2e349a8f1cd8ca19cff5`.
- Tanirbergen recovery pending: `b68b4a03e51054f6a664b88902b57325647cc6dc`.

The team plan dated 18 November supersedes the earlier proposal to merge PRs #1–9
individually. The top Bekzat branch already contains that stack. Wait for redesign,
then Tanirbergen to enter main; bring that new main into the top branch, rerun checks,
then reuse PR #9 with base main (or one owner-agreed consolidation PR). Do not merge
the lower PRs separately or squash/rewrite the existing authors' commits.

Neither prerequisite was in main when this rehearsal started. The original top branch,
PR bases and main are left unchanged. Only the preparation branch is published.
After the prerequisites land, integrate this preparation into the top branch and merge
the then-current main there. Inspect any new conflict manually; this older rehearsal
cannot certify the later combined frontend/recovery code.

## Resolutions and compatibility fixes

1. `backend/app/main.py` preserves main's RequestLimits, service-role dependencies,
   capacity handlers, readiness check, restricted CORS and hidden pilot documentation.
   Integration routers/settings/error handling are added to that application.
2. `.env.example` retains both core request-limit settings and opt-in integration flags.
   `.gitignore` retains logs, local checks, raw video exclusions and private env exclusions.
3. The histories contain **two Alembic heads**, beyond the three textual conflicts.
   `0008_core_integration_merge` joins core `0003` and `0007_guardian_cases` without
   rewriting any published migration. Both upgrade paths are exercised with retained
   synthetic rows; the rehearsal refuses a nonempty or incorrectly named database.
4. Current core clears `cooling_until` on completion/cancellation. Timeline now reads
   the persisted initial evaluation snapshot, with explicit legacy lifecycle fallbacks.
   Cancellation is a bilingual `TRANSFER_CANCELLED` event, not a rewritten decision.
   Queued notification expiry after cancellation is covered without a provider send.
5. Demo integration capabilities are explicitly rejected by the HTTP API in pilot mode,
   even when an integration enable flag is accidentally set. They remain local/test
   capabilities, not bank IAM. Worker/bot deployment must remain local/test as before.
6. Both Windows and POSIX verification runners validate the integration Compose overlay.
   CI additionally exercises both migration histories and main's PostgreSQL concurrency
   tests alongside the integration suite. Preparation branches have their own CI trigger.

No changes are made to main's frontend, scoring rules, thresholds, transfer service,
request-limit implementation or service authentication implementation. The existing nine
core OpenAPI paths and their schemas compare equal to the audited main factory; the
combined application has 41 paths. Browser access to integration capabilities must use
a reviewed server-side proxy, not CORS wildcard headers or browser token storage.

## Verification evidence

At initial rehearsal, full portable backend: **404 passed, 15 external-only skipped,
2 failed**. Failures were the historical Timeline decision regression and an engine
p95 of **21.82 ms** against the unchanged **15 ms** budget during local resource contention.
Neither failing test nor the performance budget was removed or relaxed.

After the Timeline fix, the boundary/insights suite passed **28/28**, including the
new security boundary cases and both snapshot/legacy cancellation cases. SQLite and
PostgreSQL each passed upgrades from `0003` and `0007_guardian_cases`, downgrade/upgrade,
ORM parity and synthetic record preservation. Ruff and strict mypy passed the initial
merged source; final full verification and browser evidence are recorded in the follow-up
verification section once actually executed. Historical 15 November results are not used
as proof of this merge.

Local logs are in ignored `.local-checks/`; no credentials, demo capabilities, chat IDs,
raw Telegram updates, database dumps or videos belong in this report.

## Handoff after the gate

- Recheck both prerequisite commits are ancestors of the freshly fetched main (if their
  owner chose different commit identities, inspect the accepted replacements explicitly).
- Merge in the top feature branch only, retain both parents and resolve conflicts by
  reviewing both sides. Do not select whole files with ours/theirs.
- Run full verify, real PostgreSQL/Redis tests, migration rehearsals on a **fresh dedicated
  test database**, fake Docker E2E and the unchanged `qa-mobile-soc.cjs` browser suite.
- Reuse PR #9 against main only after the above gate; request the owner's review/merge.
  Publishing this preparation branch is not that approval.
- After an authorized merge, issue short-lived demo capabilities locally using
  `python -m scripts.integration_token` and conduct the four handoff scenarios with Damir.
  Do not put those capabilities in a PR, report, browser bundle or localStorage.
- No new Telegram send grant is active; real bot acceptance requires a new explicit grant.

The additional idea in this work is a **regression guard for the merge**, not a new
product feature: declared/chunked body limits on all three integration routers, shared
peer quota, disabled-mode core behavior, pilot isolation and cancellation compatibility.

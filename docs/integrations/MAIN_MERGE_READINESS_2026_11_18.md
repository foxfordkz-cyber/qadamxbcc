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
merged source. Historical 15 November results are not used as proof of this merge.

### Completed full verification

The runtime in merge commit `f415d5a8787bf659a18d7be792b949faa6157df9` passed
[both CI jobs](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/44329289003).
The later `83cfb9b` and `3d6806f` commits change only the CI harness.

| Check | Observed result |
|---|---|
| Full local Windows `bash verify.sh`, integrations disabled | **ALL GREEN** |
| Full portable backend, local and CI | **408 passed, 15 external-only skipped** |
| PostgreSQL/Redis integrations + core PostgreSQL concurrency, CI | **238 passed, 0 skipped** |
| Unique backend cases across both suites | **423**, repeated runs not added |
| New integration regressions in this preparation | **12** (10 boundary cases + 2 cancellation cases) |
| Existing frontend | **64 passed**, zero skipped; typecheck/build passed |
| Ruff lint/format | **156 files**, PASS |
| Strict mypy | **155 source files**, PASS |
| PostgreSQL + SQLite migration rehearsal | Both source heads, round trips, ORM parity and sentinel preservation PASS |
| Core OpenAPI compatibility | Nine existing paths and their schemas unchanged; 41 total paths |
| Fake Compose E2E, CI | Six existing flows PASS |
| Ignore rules | Private env files, test caches, logs/raw video excluded; `.env.example` remains publishable |

The 423 includes the core owner's added tests; it is not a count of tests authored by
Bekzat. The team plan lists 65 frontend tests; this audited main actually has 64 and
the preparation has **zero frontend diff** against it. We do not claim the listed 65.
The final serial local run passed the original p95 assertion without changing its budget.

### Browser harness compatibility

The first browser-enabled CI (`83cfb9b`, run 44330098394) passed verify and the six fake
E2E flows, then failed **before browser tests**: ubuntu-latest had moved to Ubuntu 26.04,
unsupported by pinned Playwright 1.56.1. The compose/browser job is now pinned to Ubuntu
24.04, and uploads only the synthetic browser evidence folder (including that explicitly
named hidden folder). No UI tests, assertions, timeouts or frontend code were changed.
Browser result: **81/81 checks passed, zero browser runtime errors** in
[run 44334535955](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/44334535955),
tested head `3d6806f282db425a301b0431a4998177320b4842`; both jobs succeeded. The unchanged
script in this main contains 81 checks, not the 82 listed in the team plan. All mutations
were intercepted with synthetic API responses. Backend integration health separately
returned 503 after disabling integrations. The suite covers all three presets, RU/KK,
recovery/questionnaire flows, SOC stage mode and 320/390/768/1280 px viewports.

[Browser report/screenshots artifact](https://github.com/foxfordkz-cyber/qadamxbcc/actions/runs/44334535955/artifacts/14440249456)
is retained through 25 November. Archive SHA256:
`3cf78b9b9509ed669200166759729fb4b9256cc0d1ba71445734291fcbaea767`.
The sanitized permanent check ledger is `main-merge-evidence-2026-11-18.json`.

## Remaining external gates

At final remote-ref verification, main remained `3d19e8e`; neither redesign `03cd8f3`
nor recovery `b68b4a0` was its ancestor. The original top feature branch remains
`0de50a3` and PR #9 still targets its original feature base. No main-target PR is
claimed complete before the team's prerequisite merges. No merge into main, force push,
author rewrite, new live Telegram message or production deployment was performed.

This rehearsal is GO for review and synthetic demonstration on its tested commits.
Final step-3 acceptance against the future combined main and joint frontend acceptance
are **BLOCKED on the team's steps 1–2**, not replaced by these rehearsal results.

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

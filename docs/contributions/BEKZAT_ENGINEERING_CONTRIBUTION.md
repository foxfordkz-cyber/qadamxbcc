# Bekzat — engineering contribution ledger

Measured runtime snapshot: `b61b17d1f7358ecbf8d04d5d0bc1e33837cc0721`, 15 November 2026.
Account: **bekzatwr**. Main remains `a02d20dcc857001de364e0b0f12a66ce72db0c12`.
The initial detailed attribution audit is in BEKZAT_GITHUB_ATTRIBUTION_AUDIT.md.
No email address is published; all original 34 commits plus the audit/case/ops commits map
server-side to bekzatwr as author and committer. Verified-email flag is private/unavailable;
there is no demonstrated email attribution defect.

## Commits and PRs

| Snapshot | Unique Bekzat commits | Ordinary / merge | Reachable from main |
|---|---:|---:|---:|
| Before attribution audit, PR #7 runtime 7d8791f | 34 | 23 / 11 | 0 |
| Attribution audit 5c5843c | 35 | 24 / 11 | 0 |
| Case workstream a9e51f7 | 36 | 25 / 11 | 0 |
| Operations workstream b61b17d | 37 | 26 / 11 | 0 |

This release-evidence documentation is one additional substantive ordinary commit when
published; it does not change runtime code or the line measurements below. It is not a
placeholder commit for contributor statistics. No history was rewritten or force-pushed.

Nine Bekzat PRs: #1–7 ready for owner review; #8–9 Draft. None merged. Dependency order:
#1 → #2 → #3 → #4 → #5 → #6 → #7 → #8 → #9. After an owner-approved parent merge commit,
retarget the next PR to main, inspect the incremental diff and rerun required checks/review.
Merging into the current feature base alone does not put the code into main.

## Authored lines, with reproducible scope

Count unique primary-author commits, exclude merge diffs, then sum each ordinary commit's
`git show --numstat` relative to its parent. This is historical churn, not current LOC and
not the full main-to-feature diff. Other authors and the independent mobile-client branch are
excluded. Co-author trailers in main remain intact and are not primary-author commit counts.

| Category at b61b17d | Added | Deleted |
|---|---:|---:|
| All owned ordinary-commit churn, before exclusions | 23611 | 1034 |
| Non-generated authored churn | 14926 | 807 |
| Python implementation/scripts/migrations (subset) | 6683 | 135 |
| Python test code (subset) | 3410 | 20 |
| Excluded generated contracts, locks, evidence/media/data | 8685 | 227 |

Separately, current `git blame --line-porcelain` counts **5794 implementation** and **2938 test**
Python physical lines attributed to Bekzat, excluding blank lines, comments and AST docstrings.
This is a different measure from churn. Main-owned scoring and other authors' lines receive
no Bekzat credit. Generated OpenAPI/examples/UI labels, locks, vendored code, screenshots,
large datasets and evidence artifacts are excluded from engineering line totals. No email
from blame/log output is saved in this report or the sanitized JSON ledger.

Machine-readable counts, counted commit SHAs, excluded paths and per-file owned Python line
counts: `../guardian3/evidence/contribution-snapshot.json`. Snapshot intentionally precedes
this report commit to avoid a self-referential count; publication adds documentation only.

## Substantive engineering scope

Existing #1–7: consent/private-chat Trusted Contact, synthetic mock gateway, durable off-path
orchestration, Retry-After scheduling, SOC timeline/health, RU/KK Guardian navigation and
questionnaire, three-contact Circle with one selected recipient, explicit report submission,
retention, factual SOC summaries and live-acceptance documentation from the earlier stage.

New #8: independent case management, six-state review workflow, test-staff assignment,
category, private notes, append-only action history, optimistic versions, idempotency,
owner-only information requests/replies, independent content retention, workload analytics
and deidentified synthetic export. Three tables, migration 0007, eleven API operations.

New #9: read-only job/dead-letter inspection, delay/processing/uncertainty diagnostics,
owner permission export and history, same-host polling exclusion and process-release tests.
Four API operations, existing tables and no extra queue. No automatic resend or live messages.

New test coverage: 15 case tests, seven operations tests and fifteen new typed JSON fixture
contract cases = **37 additional unique backend cases**, 234 → **271**. Existing frontend has
12 unchanged tests. Full CI runs both portable and PostgreSQL/Redis suites; repeated execution
is not counted as new engineering tests. Six fake Docker flows cover three existing presets,
Guardian reporting, case lifecycle and operations/privacy. Recovery and timing evidence are
separately identified in GUARDIAN_3_RELEASE_REPORT.md.

Defects found during implementation: explicit SQLite cleanup needed for dependent case
records when FK pragmas are absent; contract exporter needed the new nested router mapping;
Windows occasionally denied test-child creation before lock code. Final CI and local verification
confirm current behavior; the last issue remains an explicitly recorded environmental limitation,
not relaxed Windows protection. No claim of fixing unrelated core/frontend code is made.

## Review, attribution and remaining gates

Exact-head CI for #8: run 43704163941; runtime #9: run 43706232756. Both jobs passed in each.
Old API paths/schemas compared identical to audited PR #7; main is still an ancestor and
merge-tree preparation is conflict-free. No new core/scoring/frontend changes.
Owner migration/security review and joint frontend/SOC acceptance are outstanding. We prepared
review materials, not a claimed human approval. Main merge requires separate owner permission.
Contributors cannot show these default-branch contributions until the original commits become
reachable from main; GitHub statistics can then recompute asynchronously. No artificial commits,
squash, author reassignment or cache-forcing history edits were used.

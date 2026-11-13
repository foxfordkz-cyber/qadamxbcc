# Bekzat — integrations contribution ledger

Baseline: `627fa88c9e4bd85f0704ea7c6f826f82b4182939`. Existing team commits are excluded.
Implementation is AI-assisted with Codex under Bekzat's instructions; commits use
the configured Bekzat identity, matching the connected GitHub account email.

Review stack:

1. `feature/bekzat-trusted-contact` → `main`: consent, Telegram adapter/worker,
   new owner/simulator authorization boundary, persistent audit, reversible migration,
   RU/KK messages, API contracts, integration CI and 38 test cases.
2. `feature/bekzat-nbk-mock-gateway` → A: synthetic gateway and enrichment contracts.
3. `feature/bekzat-integration-orchestrator` → B: combined off-path orchestration,
   SOC enrichment view, Docker profile, E2E and final technical handoff.

The explicit sequential stack avoids duplicating common auth/audit foundations or
creating conflicting Alembic heads. Each PR shows only its own changes. Review A,
then B, then C; after a dependency merges, retarget the next PR to main and review
the resulting diff. No force pushes or automatic merges are authorized.

PR A modules: `app/integrations/{config,security,models,audit,errors}.py`,
`app/integrations/telegram/`, `api/v1/trusted_contacts.py`, operator token CLI,
`tests/integrations/`, `alembic/versions/0002_trusted_contacts.py`.
Shared changes are limited to route/model registration, `.env.example`, dependency
resolution and a new CI workflow. Core engine, transfer logic and frontend are unchanged.

Technical problems addressed: account-bound authorization without trusting a UUID;
two-party consent; single-use links under concurrency; unique durable notifications;
revocation/delivery ordering; crash ambiguity; redacted callbacks and audit;
failure isolation; PostgreSQL/Redis verification.

Commit SHAs, PR URLs and measured line counts will be finalized on the combined
branch. Count authored Python, tests, infrastructure, documentation and generated
lockfiles separately using git diff from the baseline; do not attribute inherited
core code or generated dependency metadata as Bekzat's authored implementation.
Nothing in this stack has been merged into main by this work.

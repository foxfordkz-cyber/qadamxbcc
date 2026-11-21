# Persistent release review — 21 November 2026

The Cloudflare page at https://saq-bol-bcc.zerdeliportald.workers.dev/ is the team website. It links to https://saq-bol-mobile.onrender.com/wallet/. Both were opened in the browser. Render showed its service-waking screen before the login form appeared. Login credentials were not submitted.

Main is 182f4b0689 at inspection. PRs 25 and 26 are merged. Android 2.6/code 9 is already in main. PR 24 remains open and has been incorporated by the team's later work. The isolated branch feature/bekzat-persistent-release starts at main, preserving the previous working tree and its changes.

## Current gap

backend/Dockerfile.mobile-free uses scripts.mobile_ephemeral. It starts Redis and SQLite in a TemporaryDirectory and creates new data at startup. The current APK/web deployment cannot satisfy persistent balances, consent and history across replacement. This observation follows the deployment source. A destructive restart of the published service was not performed.

deploy/render-persistent.yaml is a proposed paid replacement for the existing saq-bol-mobile service, plus a worker and managed stores. It passed the official Render JSON schema. It is not deployed. Applying it changes a billed service and must follow owner review, budget approval and backup. Region Oregon follows the existing mobile service configuration.

API 1c-2g $25 + worker 0.5c-512mb $7 + PostgreSQL 0.1c-256mb $6 + Key Value 256mb $10 = $48/month before database disk, tax and excess usage. The API allocation is conservative pending measured RSS. Worker memory must be measured before accepting 512 MB. Current official pricing and plan IDs were checked at https://render.com/pricing and https://render.com/docs/blueprint-spec.

## Proposed cutover

1. Owner reviews the exact commit and approves billed resources. Keep automatic deployment disabled.
2. Export existing managed database with pg_dump custom format using a secret connection environment. Restore into an isolated database and verify counts, schema revision, balances and consent. The ephemeral mobile store needs an explicit export from its running process before replacement if its history is to be retained. Do not assume it is identical to the existing web PostgreSQL.
3. Provision private PostgreSQL and Key Value in Oregon. Confirm noeviction. Apply migrations in the API pre-deploy job only. Bootstrap seeds only an empty database using its existing advisory lock.
4. Set role-specific password hashes and a shared signing key as secrets. Initial integration mode is fake. API startup never creates a local store, seeds or migrates.
5. Check liveness, authenticated dependency diagnostics, account-scoped reads and concurrency. Start the worker using the same managed connection settings.
6. After fresh chat consent, set test Telegram parameters on both processes. The existing hosted runner owns a PostgreSQL advisory lock and cancels processing on loss of that connection. Confirm previous polling is stopped and only one consumer exists.
7. Route the team's client/SOC entry points to the persistent gateway, build the next APK against its confirmed HTTPS origin and record its exact certificate and digest.
8. Verify two-way transfers and callbacks on one release, restart API/worker, then leave idle 30 minutes and test from a phone with all local project services stopped.

Rollback restores the previous pinned application image against its compatible schema. Do not downgrade a populated database automatically. Restore backups to a separate database first. Damir owns infrastructure review and payment approval. No external alert recipient is enrolled by this change.

## Remaining independent work

The requested 2.7 visual redesign, public route consolidation, release manifest, new screenshots, physical device acceptance and stable cloud validation remain pending. This document records deployment preparation only. Current adb inventory is empty. Render dashboard access was not available in the current browser session.

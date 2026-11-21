# Persistent release review — 21 November 2026

The Cloudflare page at https://saq-bol-bcc.zerdeliportald.workers.dev/ is the team website. It links to https://saq-bol-mobile.onrender.com/wallet/. Both were opened in the browser. The Render dashboard is now accessible in the user's Codex browser. The existing service deploys main, Dockerfile.mobile-free, commit 2ffc009ee7a9cd9b5b7b0711a7deb7aeeb3bc2a5 (2.6). No dashboard configuration was changed. The previous local client password was rejected by this public service; local comparison against its configured hash confirmed the mismatch without printing either value.

Main is 182f4b0689 at inspection. PRs 25 and 26 are merged. Android 2.6/code 9 is already in main. PR 24 remains open and has been incorporated by the team's later work. The isolated branch feature/bekzat-persistent-release starts at main, preserving the previous working tree and its changes.

## Current gap

backend/Dockerfile.mobile-free uses scripts.mobile_ephemeral. It starts Redis and SQLite in a TemporaryDirectory and creates new data at startup. The current APK/web deployment cannot satisfy persistent balances, consent and history across replacement. This observation follows the deployment source. A destructive restart of the published service was not performed.

deploy/render-persistent.yaml is a proposed paid replacement for the existing saq-bol-mobile service, plus a worker and managed stores. It passed the official Render JSON schema. It is not deployed. Applying it changes a billed service and must follow owner review, budget approval and backup. Region Oregon follows the existing mobile service configuration.

Proposed initial demo compute: API 0.5c-512mb $7 + worker 0.5c-512mb $7 + PostgreSQL 0.1c-256mb $6 + Key Value 256mb $10 = $30/month before database disk, tax and excess usage. The final acceptance job enforces 512 MiB memory (no swap) and 0.5 CPU for both containers and records cgroup peaks. A passing small synthetic workload is not a production capacity guarantee; do not increase a paid plan without approval. Current official pricing and plan IDs were checked at https://render.com/pricing and https://render.com/docs/blueprint-spec.

Existing saq-bol-api-db and saq-bol-api-cache are also Free, not already-paid substitutes. The dashboard shows PostgreSQL 18, an expiration date of 20 December 2026, and Valkey 8 / 25 MB with noeviction. They belong to the separate core stand. The mobile factory explicitly rejects sharing its store with the private web circle; do not attach it blindly to this database. Existing resources/data stay untouched. CI now exercises PostgreSQL 18 and Valkey 8 in addition to the original PostgreSQL 16/Redis 7 suite. After the synthetic workflow, a single Docker stats observation was 162.5 MiB for API and 268 MiB for worker; this is not peak memory, a load test, or a capacity guarantee.

## Proposed cutover

1. Owner reviews the exact commit and approves billed resources. Keep automatic deployment disabled.
2. Export existing managed database with pg_dump custom format using a secret connection environment. Restore into an isolated database and verify counts, schema revision, balances and consent. The ephemeral mobile store needs an explicit export from its running process before replacement if its history is to be retained. Do not assume it is identical to the existing web PostgreSQL.
3. Provision private PostgreSQL and Key Value in Oregon. Confirm noeviction. Apply migrations in the API pre-deploy job only. Bootstrap seeds only an empty database using its existing advisory lock.
4. Set role-specific password hashes and a shared signing key as secrets. Initial integration mode is fake. API startup never creates a local store, seeds or migrates.
5. Check liveness, authenticated dependency diagnostics, account-scoped reads and concurrency. Start the worker using the same managed connection settings.
6. After fresh chat consent, set test Telegram parameters on both processes. The existing hosted runner owns a PostgreSQL advisory lock and cancels processing on loss of that connection. Confirm previous polling is stopped and only one consumer exists.
7. Route the team's client/SOC entry points to the persistent gateway, build the next APK against its confirmed HTTPS origin and record its exact certificate and digest.
8. Verify two-way transfers and callbacks on one release, restart API/worker, then leave idle 30 minutes and test from a phone with all local project services stopped.

Rollback restores the previous pinned application image against its compatible schema. Do not downgrade a populated database automatically. Restore backups to a separate database first. The user identified the open Render account as Damir's; Bekzat owns the mobile work. Billing approval must come from an authorized account owner and remains pending. No external alert recipient is enrolled by this change.

## Release 2.7 implementation

The mobile client and web wallet share the modified wallet.mjs, connected.mjs and wallet.css. Home now separates the primary transfer action from secondary actions; recipients and recent operations precede explanatory protection on phones. Desktop uses a card/action column, a protection/weekly-summary column and separate recipient/activity sections. The existing team's Saq Bol × BCC identity is preserved. Transfers show their account balance and a three-step progression; review emphasizes the amount. The pause, analytics and SOC layouts use distinct information/action columns on desktop. No financial or scoring rules changed.

The balance visibility control also masks the new weekly summary. Russian/Kazakh and 200% text are covered at 360, 412 and 1440 pixels. Browser screenshots from the layout test use explicitly synthetic HTTP fixtures; they are evidence of rendering, not live bank or deployed service acceptance.

Public / serves a bilingual product entry. /soc/ enters the same session-based shell; the server still chooses the role. /download/ refuses to advertise an absent release manifest. The web build calculates the real APK SHA-256 and per-asset digests when an APK has actually been packaged into install/. No passwords are published there.

/health is liveness; /ready checks PostgreSQL and Redis with a two-second bound and five-second coalesced cache, returning only ready/unavailable. Telegram availability does not gate it. Authenticated integration health and the existing worker heartbeat provide detailed queue/worker diagnostics.

## Acceptance still required

Paid cloud cutover, public same-release APK/web/SOC acceptance, idle-30-minute and local-services-off checks require approved hosting, usable mobile credentials and preservation of the old store. Dashboard access is confirmed. Honor VNE-LX1 / Android 14 is authorized, and 2.7/code 10 was installed as an update without data deletion. Successful cloud login/transactions remain unverified. Live Telegram requires a fresh scoped consent session after hosted configuration. These gates remain open even if build and CI succeed.

README credentials explicitly belong to saq-bol-jury.onrender.com and its disposable rooms. They did not match the mobile service's client hash in a local comparison. No guessing/brute-force or password reset was performed. Free Render has no shell/one-off jobs, so changing the mobile plan/env or redeploying before a verified export would put its temporary history at risk. Do not treat an exported env configuration as a database backup. If the old temporary history cannot be exported, obtain explicit owner direction rather than silently discarding it.

## Demonstration (2:45)

0:00–0:25: sign in as client; show the server balance and synthetic-data notice. 0:25–0:55: use the normal preset, inspect the receipt and the same transaction in the other client. 0:55–1:35: use the social-engineering preset; show the server deadline, money state and Guardian delivery mode. 1:35–2:00: client answers/cancels; a contact is advisory only. 2:00–2:30: sign in as SOC, open that transaction/case and its timeline. 2:30–2:45: compare the final status in APK and web. On a fake-adapter stand explicitly say delivery is simulated; do not claim a Telegram callback occurred.

# Mobile login recovery audit — 21 November 2026

## Result: login recovered without a restart; persistent hosting still pending

The original local demo passwords differed from the corresponding Render hashes. The user subsequently supplied three original handoff files in Windows Downloads. All three now pass the actual public login endpoint with their expected roles. The client, SOC employee and platform administrator interfaces were opened on Honor and in the web wallet. No cloud settings, passwords, data, service plan or running deployment were changed. No server restart, uninstall or Android data clear was performed.

## Verified deployment and request

- Honor VNE-LX1, Android 14, package `kz.qadamx.bccshield.demo`: installed base.apk was pulled read-only and inspected with aapt2. Its `qadam_api_origin` is `https://saq-bol-mobile.onrender.com`.
- Installed APK SHA-256: `ce81184ce739c745b33b646041fc365232797f5001462e3279a2dbe03ff730b8`; matches the delivered 2.7/code 10 artifact.
- Render Dashboard reports last successful revision `2ffc009ee7a9cd9b5b7b0711a7deb7aeeb3bc2a5`, Free compute, Dockerfile.mobile-free. The public server has not received PR #27.
- At that exact revision, `POST /mobile/v1/auth/login` expects JSON `login` and `password`. A mismatched scrypt password returns `401 invalid_credentials` before database checks. Malformed bodies return validation errors instead. The APK uses this contract.
- Role mappings: client_demo -> client / subject ending 0001; admin_demo -> admin / subject ending 0099; platform_demo -> platform_admin / subject ending 0098. Credentials are environment-configured, not password rows in PostgreSQL. Successful login, protected session/account reads and the platform staff endpoint now confirm client existence and enabled staff access.

## Source of mismatch

The dashboard contains BCC_MOBILE_CLIENT_HASH, BCC_MOBILE_ADMIN_HASH and BCC_MOBILE_PLATFORM_HASH. Authorized local comparison using the deployed scrypt parameters confirmed that **both** DemoAccounts passwords fail against their corresponding configured hashes. Neither plaintext nor hash was printed or committed. The earlier mobile-access handoff also fails both comparisons.

`%LOCALAPPDATA%\QadamShield\DemoAccounts\client_demo.json` and `admin_demo.json` were created on 20 November. The preserved `mobile_v2_start.py` reads these files to configure a local gateway on port 18012, PostgreSQL database `qadam_android_v2`, Redis database 14. Those files have no server-origin metadata. This establishes their use by the old local stand, not their use during Render provisioning. The available task scripts do not establish who entered the different Render hashes or which original plaintext handoff was used. Do not attribute that action to a person without evidence.

README credentials belong to the separate saq-bol-jury service and disposable rooms. They are not the mobile wallet's credentials. No password guessing or brute force was attempted.

`scripts.mobile_accounts.provision` creates absent local files once and preserves existing files. The deployed `scripts.mobile_ephemeral` does **not** generate demo passwords: it requires existing environment hashes. Its random signing key is unrelated to password verification. Therefore automatic password regeneration on each public-server restart is not the cause of this 401.

## Storage and loss mechanism

Dockerfile.mobile-free runs `scripts.mobile_ephemeral`. That exact deployed launcher creates a new `TemporaryDirectory(prefix="saq-mobile-")`, points BCC_DATABASE_URL at its `mobile.db` SQLite file, and points BCC_REDIS_URL at a local Unix socket. It overrides external database URLs. It starts redis-server with persistence disabled (`--save "" --appendonly no`), creates tables and seeds synthetic records. There is no connection from this launcher to the team's managed PostgreSQL/Valkey.

A process replacement creates a different empty SQLite database and re-seeds it. It does not preserve the prior database merely because deterministic demo account IDs recur. The temporary directory is also removed on normal exit; an ephemeral container filesystem cannot serve as a backup. The loss mechanism exists even if the service plan is upgraded without changing this launcher.

At risk are all post-seed changes held by that mobile instance: balances, transfers and idempotency records, reports, cases/audit/timeline, contact/consent/protection state and any other SQLite records, plus Redis sessions and transient state. Exact current row counts are unknown without authenticated access or a database export. The separate core database is not part of this loss and remains untouched.

## Recovery and backup limits

The actual Shell screen explicitly says Shell is unsupported on Free compute and requires an upgrade. Compute also excludes SSH, one-off jobs and persistent disks. No upgrade was selected. The deployed staff API changes employee enabled/version state; it cannot rotate password hashes or export the database. The reviewed mobile API has no full-database backup/recovery endpoint. A platform role would not by itself supply those missing operations.

No already-authorized path to the running SQLite file was found. No complete backup or restoration rehearsal exists for that public instance. A list of transactions, an environment export or a backup of the separate team PostgreSQL would not be a backup of this mobile instance. Changing hashes via redeploy cannot meet the user's preservation requirement. Do not deploy a new backup endpoint to this disposable service as a supposed preservation method: the deploy itself replaces its state.

The least disruptive recovery was completed using the original handoff supplied by the user. No reset was needed. Render inactivity/restarts can still independently discard the temporary history; restored login does not fix retention. Successful authenticated read access also does not create a full-database backup route.

## Targeted provenance search

Commit 573704a1db835c019d088281e0055a74fe638ac7 introduced the separate mobile Render profile on 20 November. Commit be8dabc6664b9d7c52c8151d83d97d245359af84 set the APK default origin to saq-bol-mobile. Both are integration commits authored by Damir Karabek; this identifies source authorship, not the person who entered cloud secrets. The accessible Render Dashboard points to this repository/main and the same deployment files, confirming a managed team stand.

The bounded search covered the project's worktrees, deployment and account scripts, Android documentation, saved task reports, the paths those scripts reference, and available chat history around the mobile rollout. The related older hackathon workspace had no saq-bol-mobile/private-account references. No new original credential file was found by that search. No unrelated personal directories were searched. The user's later files in `C:\Users\user\Downloads` resolved the missing-source problem; the already-rejected credentials were not repeatedly submitted.

## Permanent fix prepared, not applied

PR #27 includes Dockerfile.persistent, start-persistent.sh and render-persistent.yaml. Runtime requires managed PostgreSQL/Redis, does not create temporary databases and does not seed on API restart. Separate pre-deploy migration/bootstrap seeds only an empty database under a PostgreSQL advisory lock. Existing hashes remain explicit secrets.

The existing team PostgreSQL is a distinct resource. The mobile factory rejects private web-circle sharing; no direct connection, schema change or migration against it was attempted. Reuse requires an explicitly isolated database and owner-reviewed configuration, not silently pointing this gateway at core tables. The supplied separate-resource blueprint has an estimated $30/month compute subtotal plus database storage/taxes/usage, as documented in PERSISTENT_RELEASE_REVIEW.md; billing approval remains absent. No resource was purchased.

CI previously validated isolated PostgreSQL/Valkey restart persistence and repeat initialization. This is not a verified backup or a successful restart of the actual public mobile instance. The separate local `mobile_demo` launcher did regenerate access.json: it now creates credentials only if absent, reuses valid existing credentials and refuses damaged/incomplete files without overwriting them. Six regression cases cover provisioning/restart/incomplete files; together with existing bootstrap and password-session tests, eight focused tests pass. Ruff and mypy pass. This local-runner fix is not deployed to the public service, which uses mobile_ephemeral.

## Acceptance gates and credential handoff

Passed: three real HTTPS logins and session-role reads; twelve role allow/deny checks; all three role interfaces on Honor and web; web reload session recovery. Honor restored the client home after an actual app process stop/relaunch without re-entering credentials. It is left signed in as client. No adb reverse or API proxy was used. The public client snapshot contains 12 operations; reports and cases are empty. Balance, complete paginated client operations, available report/case read models and staff access state match before/after this acceptance. This does not prove that older unobserved records survived an earlier Free-service restart. No new transfer/report/case was created during login acceptance.

The validated records are saved under `%LOCALAPPDATA%\QadamShield\DemoAccounts\` as client_demo.json, admin_demo.json and platform_demo.json, with origin, service ID, role and verification timestamp. Previous local-stand files are preserved in an ACL-protected `previous-local-stand` subdirectory. The original Downloads files remain untouched. The obsolete reset plan was never applied and must not be used.

No passwords or hashes are part of the repository evidence. Remaining hosting gate: a verified full backup/migration and explicit infrastructure approval before any destructive cutover or public restart. Existing team PostgreSQL remains untouched.

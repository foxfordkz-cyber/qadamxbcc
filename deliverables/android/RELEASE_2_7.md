# Saq Bol / Qadam Shield 2.7 — acceptance in progress

Date: 21 November 2026, Asia/Qyzylorda. Review branch: feature/bekzat-persistent-release, PR #27. No main merge or paid infrastructure creation.

## Artifact and installed build

Saq-Bol-Android-2.7.apk is version 2.7 / code 10, package kz.qadamx.bccshield.demo. Exact digest, source commit, API origin and certificate are recorded in Saq-Bol-Android-2.7.json. The final APK was built with local Gradle assembleDebug/lintDebug and the existing Android test identity. All 28 packaged top-level HTML/CSS/MJS/SVG files were compared byte-for-byte (normalized checkout line endings) with source daea694. The same check now gates the persistent Docker build, so a stale APK cannot silently accompany a newer web UI.

Honor VNE-LX1 accepted the update over 2.5/code 8 without uninstalling or clearing application data. The application started. It contacted the configured public HTTPS service through the phone's normal network and displayed the server's invalid-credentials result for the previous locally stored client_demo account. No adb reverse, API proxy or local gateway substituted for this request. USB forwarding was used only to automate the application's WebView debugger.

After the user completed the Android Play Protect check, the final rebuilt APK also installed successfully. Eight bounded physical checks are recorded in [native-checks-27.json](review27/phone/native-checks-27.json): installation, RU/KK, login retention, actual HTTPS wrong-password rejection, explicit offline overview/large text, Back, background/reopen and return to real sign-in. [Login](review27/phone/login-viewport-27.png), [offline home](review27/phone/offline-home-viewport-27.png), [server rejection](review27/phone/invalid-credentials-27.png) are actual native WebView captures. The overview is visibly labelled offline and does not prove an authenticated cloud operation. Browser interception cannot simulate failure of Capacitor's native HTTP transport; that attempted physical failure scenario is not counted as passed.

The public service's /health returned HTTP 200 with ephemeral_store=true. Therefore this is **not** acceptance of a durable same-release cloud deployment. Render dashboard access is confirmed. Local hash comparison showed that both the old local password and the README's jury-client password differ from this mobile server's configured credential. README explicitly documents a separate disposable jury-room service. No password was changed, no service restarted and no data discarded. Passwords, hashes and tokens are absent from this report.

## Changes

- Home has a separate primary transfer action, compact secondary actions, recipients/history before explanatory protection on phones, and a two-column desktop composition.
- Transfer shows the account balance and progress; confirmation emphasizes amount/recipient; pause separates its server timer from next actions. Analytics and SOC adapt to a wider workstation.
- Balance masking includes the weekly summary. RU/KK, account isolation and existing server-defined roles are preserved. No financial/scoring policy changed.
- Fixed a reproduced sign-in defect: switching RU/KK after typing the login no longer clears it. The existing outage/recovery browser test covers this transition; passwords are not persisted with it.
- Paid Render blueprint, non-root persistent Docker image, controlled migrations and idempotent seed; no bundled local SQLite/Redis server.
- Separate bounded readiness check for PostgreSQL/Redis; existing worker heartbeat and authenticated diagnostics remain in use.
- Product entry, SOC entry, conditional APK download, actual SHA-256 and asset manifest. Host deployment remains gated by owner budget/access.

## Evidence boundaries

Local mobile unit tests: 28 passed. Local browser suite: 23 passed, 3 skipped because their separately configured live backend/jury fixtures were not enabled. The skipped PostgreSQL/Redis gateway scenario is exercised separately by GitHub's Android gateway E2E job. Two other skipped scenarios require their dedicated role/jury servers; they must not be called passed.

Targeted backend: 27 existing mobile gateway tests plus 5 new readiness/release-route cases passed (32 distinct cases, not the sum of overlapping reruns). Readiness checks cover critical-dependency failure, cache/coalescing and recovery; public release entry does not grant SOC or advertise an absent artifact.

CI identified and fixed a real deployment defect: the model trainer writes a root-only artifact; the non-root runtime could not load it during bootstrap. The image now gives this baked model read-only permissions. The expanded PostgreSQL 18/Valkey 8 acceptance passed all three actual transfer presets, client/SOC agreement, one monetary effect on replay, conflicting-amount rejection, API/worker recovery, dependency failure/readiness recovery and a second non-destructive migration/bootstrap. The final worker probe avoids importing another ML runtime and removes the old heartbeat while the worker is stopped.

The full verification on source daea694 passed 709 backend cases with 25 skipped in the first environment, then 346 PostgreSQL/Redis cases, 177 frontend cases, migrations upgrade/downgrade, type checks and Docker Compose E2E. The backend sets overlap: do not add 709 and 346. CI now exports JUnit from both invocations and backend-unique.json with their union and remaining skipped IDs. Local Android assembleDebug and lintDebug passed. The focused browser rerun passed both cases after the login fix; it overlaps the earlier 23-case run.

Browser comparison images use the same explicit synthetic HTTP fixtures, account, language and 360px viewport against source 6b4a9e6 (2.5) and the 2.7 sources. These are actual rendered screens, **not public-server or physical-phone evidence**. Separate native screenshots are labelled phone.

## Open gates

Full CI must be checked on the final packaging commit. Physical successful client/admin login, transfers, Guardian and case mutation remain blocked by the public account mismatch. New live Telegram delivery has not been performed. Hosting payment approval, tested export of the temporary store, permanent PostgreSQL/Key Value cutover, idle-30-minute and local-services-off checks are still required. Emulator startup was retried after Gradle finished: Windows reported only about 1.2 GB remaining commit capacity against 4 GB needed. No emulator test is claimed and system memory/security settings were not weakened. No production-ready claim.

# Saq Bol / Qadam Shield 2.7 — acceptance in progress

Date: 21 November 2026, Asia/Qyzylorda. Review branch: feature/bekzat-persistent-release, PR #27. No main merge or paid infrastructure creation.

## Artifact and installed build

Saq-Bol-Android-2.7.apk is version 2.7 / code 10, package kz.qadamx.bccshield.demo. Exact digest, source commit, API origin and certificate are recorded in Saq-Bol-Android-2.7.json. The GitHub-built APK was signed with the existing local Android test identity. Packaged HTML/CSS/MJS/SVG were compared byte-for-byte (normalized checkout line endings) with the current source.

Honor VNE-LX1 accepted the update over 2.5/code 8 without uninstalling or clearing application data. The application started. It contacted the configured public HTTPS service through the phone's normal network and displayed the server's invalid-credentials result for the previous locally stored client_demo account. No adb reverse, API proxy or local gateway substituted for this request. USB forwarding was used only to automate the application's WebView debugger.

The public service's /health returned HTTP 200 with ephemeral_store=true. Therefore this is **not** acceptance of a durable same-release cloud deployment. The owner must reconcile the public service's demo-account hashes with the team's privately held credentials. Passwords and tokens are absent from this report.

## Changes

- Home has a separate primary transfer action, compact secondary actions, recipients/history before explanatory protection on phones, and a two-column desktop composition.
- Transfer shows the account balance and progress; confirmation emphasizes amount/recipient; pause separates its server timer from next actions. Analytics and SOC adapt to a wider workstation.
- Balance masking includes the weekly summary. RU/KK, account isolation and existing server-defined roles are preserved. No financial/scoring policy changed.
- Paid Render blueprint, non-root persistent Docker image, controlled migrations and idempotent seed; no bundled local SQLite/Redis server.
- Separate bounded readiness check for PostgreSQL/Redis; existing worker heartbeat and authenticated diagnostics remain in use.
- Product entry, SOC entry, conditional APK download, actual SHA-256 and asset manifest. Host deployment remains gated by owner budget/access.

## Evidence boundaries

Local mobile unit tests: 28 passed. Local browser suite: 23 passed, 3 skipped because their separately configured live backend/jury fixtures were not enabled. The skipped PostgreSQL/Redis gateway scenario is exercised separately by GitHub's Android gateway E2E job. Two other skipped scenarios require their dedicated role/jury servers; they must not be called passed.

Targeted backend: 27 existing mobile gateway tests plus 5 new readiness/release-route cases passed (32 distinct cases, not the sum of overlapping reruns). Readiness checks cover critical-dependency failure, cache/coalescing and recovery; public release entry does not grant SOC or advertise an absent artifact.

CI identified and fixed a real deployment defect: the model trainer writes a root-only artifact; the non-root runtime could not load it during bootstrap. The image now gives this baked model read-only permissions. The persistent acceptance job subsequently passed password login, client/SOC isolation, preserved account/ledger/session across container restart, and a second non-destructive migration/bootstrap.

Browser comparison images use the same explicit synthetic HTTP fixtures, account, language and 360px viewport against source 6b4a9e6 (2.5) and the 2.7 sources. These are actual rendered screens, **not public-server or physical-phone evidence**. Separate native screenshots are labelled phone.

## Open gates

Full CI must be checked on the final commit. Physical successful client/admin login, transfers, Guardian and case mutation remain blocked by the public account mismatch. New live Telegram delivery has not been performed. Hosting approval/access, tested export of the temporary store, permanent PostgreSQL/Key Value cutover, idle-30-minute and local-services-off checks are still required. Emulator acceptance is not yet complete. No production-ready claim.

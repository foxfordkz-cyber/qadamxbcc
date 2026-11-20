# Qadam Shield 2.2 · Android wallet and SOC

Capacitor packages the product entry point at `android-app/www/index.html`. The client and SOC share one emerald/light theme, with original contour artwork for the synthetic card, consistent icon buttons and persistent role-specific navigation. The wallet, quick contacts and period selector take inspiration from the three supplied references. Russian and Kazakh are provided in the app. Physical acceptance materials are delivered separately with the signed test APK.

## Read models

All paths below start with `/mobile/v1`. Session identity controls access. No role, owner, opening balance or final decision comes from the handset.

| Path | Role and semantics |
| --- | --- |
| GET /account | Client. Synthetic opening amount of 5,000,000 tenge plus approved receipts less approved outgoing transfers over account history. The last four characters are an alias from the synthetic account. Holds are reported separately. |
| GET /wallet/operations | Client. Outgoing attempts and posted receipts. Filters include status, direction, full transaction ID or counterparty name, calendar day, period and offset. |
| GET /wallet/incoming/{id} | Receiving client. Minimal receipt for an approved transfer. |
| GET /wallet/analytics?days=7 | Client. Daily incoming and outgoing amounts and counts. Supports 7, 30 and 90 dates in Kazakhstan, using creation time and current status. Empty dates have zero values. |
| GET /wallet/soc?days=7 | SOC. Counts and sums by current decision, distinct blocked recipients, case states for cases opened in the period, and mean recorded engine latency. |
| GET /wallet/cases | SOC. Optional state, report ID and offset filters. Opening an existing report case retrieves the original case and history. Expired cases are omitted. Actions use the existing versioned case API. |
| GET /api/integrations/guardian/soc/cases/{id}/history | SOC. Persisted case action history, including requests for information. |

The financial evaluation, scoring, mandatory holds and idempotent request protocol remain in the core. A terminal incoming receipt does not grant access to the sender’s internal risk analysis. The contact limit and public Telegram username come from the server. The app uses a native intent with an HTTPS fallback. Opening Telegram alone does not change contact consent. The fake test adapter supports a private synthetic invitation code. A real Telegram invite can be shared only when delivery is configured for test mode.

## Demonstration in 2 minutes 45 seconds

1. **0:00–0:25** Enter as `client_demo`. Show the card, hide and reveal the balance, and open a recent counterparty.
2. **0:25–1:05** Open Transfers and the demo presets. Submit the social-engineering example. End the simulated call and open the transfer receipt. Show the server deadline, questionnaire and family notification state.
3. **1:05–1:45** Open Protection, Telegram Guardian and Trusted Circle. Open Analytics, switch from 7 to 30 days and select a bar to see the corresponding ledger entries.
4. **1:45–2:10** From an operation send a synthetic report about a caller demanding a transfer. Show its receipt.
5. **2:10–2:45** Sign out and enter as `admin_demo`. Open the report, create its case, take it into review and open the persisted history or linked operation. The public demo uses virtual funds.

## Installation and review

Use the signed team APK to update the existing demo in place. The Android application ID is `kz.qadamx.bccshield.demo`, version 2.2 (5). The endpoint compiled from `demo-origin.txt` requires an active HTTPS gateway, PostgreSQL and Redis. The temporary tunnel address can change after a restart. Keep demo credentials in the protected team store. No production release is implied.

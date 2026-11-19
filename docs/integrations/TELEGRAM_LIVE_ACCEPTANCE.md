# Authorized real Telegram acceptance — 2026-11-14

> Additional real assistant/menu acceptance ran on 18 November 2026 with a fresh grant.
> The 14 November delivery evidence below remains a separate historical session.
> See the dated addendum at the end; neither completed grant authorizes future sends.

The existing user's test bot was connected; no new bot/account was created by the agent.
The owner entered the token into a hidden local prompt. A fresh /start challenge from
the authenticated Telegram Bot API identified the owner's private chat. Only that chat
was allowlisted. The owner then separately authorized up to 12 test messages.
No real customer, bank data, money transfer or NBK request was involved.

## Observed evidence

Actual provider responses and recipient button interactions confirmed one RU and one KK
Cooling-Off alert. The service additionally sent three bilingual consent prompts and
six service replies/invitation links: 11 sendMessage calls accepted in total, below
the authorized ceiling of 12. This count excludes callback-answer popups.
Provider acceptance alone is not proof of reading; the owner's real acknowledgment
and suspicion callbacks supply recipient-side evidence for both alert languages.

| Scenario | Result and evidence |
|---|---|
| Bot identity / private chat | LIVE PASS: getMe plus unique /start challenge; no guessed ID |
| Invitation / binding | LIVE PASS: real /start consumed invitation, remained pending until consent |
| Decline | LIVE PASS: real revoke callback changed first contact to CONTACT_REVOKED |
| Consent RU/KK | LIVE PASS: independent Telegram button consent created CONTACT_VERIFIED |
| Cooling-Off | LIVE PASS: existing core preset returned cooling_off, optional job queued afterward |
| RU alert | LIVE PASS: NOTIFICATION_SENT then SUSPICION_REPORTED |
| KK alert | LIVE PASS: NOTIFICATION_SENT then CONTACT_ACKNOWLEDGED |
| Duplicate suspicion | LIVE PASS: user pressed twice; one persisted suspicion event |
| SOC reload / Timeline | LIVE PASS: fresh API reads retained signals and matching correlations |
| Restart | LIVE PASS: runtime restarted after RU; no second RU alert; history preserved |
| Revoked recipient / new notification | LIVE API PASS: 409 contact_consent_required for a different active cooling transaction |
| Missing owner consent | LIVE API PASS: 422; no contact created |
| Simulator isolation | LIVE API PASS: real-mode simulator request rejected |
| Old callback / used invitation | Recipient reported both rejected; no consent restoration observed. One-use/callback validation also has controlled regression coverage |
| Private/group/foreign identity boundaries | Controlled dispatcher/adapter tests; no messages to another real chat or group |
| 429, long Retry-After, timeout, outage, expiry | Controlled adapters/PostgreSQL tests only; no deliberate Telegram load or real 429 claim |

The RU acknowledgment and suspicion were pressed in rapid sequence; only suspicion
was persisted as a state change. KK acknowledgment was tested separately and persisted.
Both core transfers remained cooling_off: no resolve-cooling request was made by the
live acceptance flow, and contacts never authorized funds.

## Secret handling and recovered Windows setup

The first setup saved an encrypted DPAPI SecureString before Get-Acl failed. Inspection
checked format/rights without printing the token. The script now imports the Security
module matching its actual PowerShell executable. ACL persistence changes only the DACL,
preserving ownership and audit SACL; it does not require unrelated SeSecurityPrivilege.
The directory/file allow only the current Windows user. Synthetic SecureString roundtrip,
plaintext-absence and effective ACL checks passed; repeat validation retained the secret.
The token did not need re-entry or rotation.

The task-owned obsolete interactive console was closed. Repair/validation run without
an interactive PSReadLine prompt; no user history was deleted or rewritten. Private
config, chat ID, grants and invitation links stay outside Git and evidence archives.
Only sanitized counts, states, event codes and timestamps are exported.

## Completion and limits

Both live contacts are revoked at cleanup; the short-lived send grant is closed and
polling/worker acceptance runtime is stopped. The bot token remains encrypted locally
for a later explicitly authorized test. No competing polling instance was started.
The fake demo remains separately usable. These results verify this controlled test
environment, not production bank IAM, delivery SLA or a general Telegram certification.

Implementation dependencies: PR #1 (durable retry/worker recovery), PR #2 (MOCK gateway),
PR #3 (orchestration). Timeline and diagnostic Health are additive review work.
The final verification package records checked commit SHAs, CI and sanitized live evidence.
The checked-in [telegram_live_evidence.json](telegram_live_evidence.json) records the
final revoked-contact states, persisted event codes and 11 accepted send timestamps.

## Assistant menu acceptance — 18 November 2026

Finalized 19 November. The owner separately authorized 12 replies and 30 menu updates
within 30 minutes in the previously verified private chat. Existing DPAPI configuration
and ACL validated; no token re-entry or new bot was needed. The notification worker
was disabled throughout. Only synthetic accounts/report data were used.

- Nine `sendMessage` attempts were accepted by Telegram, within the shared budget.
  The user confirmed the consent/menu screens and actual report receipt.
- Twenty of 22 attempted menu updates have confirmed provider-success entries. The
  other two are not counted as successful; no uncertain send was retried.
- Real consent, KK navigation, security/privacy screens, questionnaire cancellation and
  rejection of the old survey step were exercised. `/reports` opened the saved receipt;
  `/notifications` correctly showed no notifications in this worker-disabled session.
- One report was submitted by the user through a real preview/confirmation button.
  SOC read and demo acknowledgment succeeded, and the user saw the updated status.
  The same single report survived the polling-process restart.
- The user found that consent left the old consent controls on screen. The bot now
  opens its menu by editing that message; the user confirmed the corrected automatic
  transition after a technical restart within the same deadline and cumulative budgets.
- The final recorder encountered a Windows file-replacement `PermissionError`; its
  precise OS cause is unknown. Bounded local file retries were added and verified with
  a synthetic held-reader test. This never retries a provider send or alters ACLs.
  Final state independently confirms revoked test consent, inactive grant and stopped
  poller. The test PostgreSQL/Redis containers were stopped with their volumes retained.

This session did not send a new Cooling-Off alert and does not recertify the historical
RU/KK delivery scenarios above. Production, banking operations and real 429 injection
remain outside scope. [Feature report](../guardian/BOT_ASSISTANT_2026_11_18.md) and
[sanitized ledger](../guardian/evidence/bot-assistant-live-2026-11-18.json) distinguish
provider acceptance, recipient confirmation, automated tests and observed limitations.

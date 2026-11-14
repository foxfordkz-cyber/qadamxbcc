# Authorized real Telegram acceptance — 2026-11-14

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

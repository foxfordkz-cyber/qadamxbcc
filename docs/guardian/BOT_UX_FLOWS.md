# Guardian navigation

Private allowlisted /start without an argument opens the bilingual demo welcome/menu.
/start with an invitation continues the existing one-use binding and separate consent flow.
/menu and /help open navigation. Seven inline actions work in RU and KK: security,
notifications, contacts, scam check, history, language and help. Content uses plain text;
no user text is interpreted as Markdown/HTML. Inline navigation edits the existing bot
message; an edit failure never triggers a new send to conceal an ambiguous result.

Language choice resets the current survey. Main menu/Finish clears survey answers.
Redis FSM data expires after 15 minutes and uses bot/chat/user-scoped keys. Event isolation
serializes concurrent updates; survey callback nonce and expected question index reject
replays and previous surveys. Redis failure must not fall back to unauthenticated state.

Recipient security/contacts shows verified consents only. Notifications/history shows
the last ten notifications addressed to currently consenting bound contacts, without
owner identity, bank details or Telegram IDs. Revocation erases the delivery address,
so the bot deliberately cannot recover revoked contacts by guessing a banking identity.
An empty view explains the protected-app invitation and authorization boundary.

Owner management remains in authenticated APIs; the Telegram recipient cannot mint an
owner capability. General incident submission and enhanced consent management are separate
P1 work; the educational draft button explicitly says nothing has been submitted.

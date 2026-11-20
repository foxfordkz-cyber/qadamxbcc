# Local fake Telegram and opt-in test bot

The team's test bot is [@bekzat_bcc_shield_test_bot](https://t.me/bekzat_bcc_shield_test_bot). Its token belongs in the backend secret store under `BCC_INTEGRATIONS_TELEGRAM_TOKEN`. The mobile client's test-mode invitation opens this bot. An allowlisted participant can open the assistant menu before giving separate consent to any trusted-contact invitation. Keep the integration signing key on the operator side of the public web demo.

### Hosted hackathon demo

The API on Render can run the Telegram poller and notification worker in the same process. Set `BCC_RENDER_TELEGRAM_TEST=true`, `BCC_INTEGRATIONS_ENABLED=true`, `BCC_INTEGRATIONS_ENVIRONMENT=test`, `BCC_INTEGRATIONS_TELEGRAM_MODE=test`, a random secret `BCC_INTEGRATIONS_SIGNING_KEY`, the bot token and `BCC_INTEGRATIONS_TELEGRAM_ALLOWED_CHAT_IDS` (a JSON array of confirmed private chat IDs) on the API. Redeploy the web service. The database lock allows one hosted runner at a time. Private chat commands include `/start`, `/menu` and `/language`.

On the free Render plan, the web service can sleep. Open [the API health endpoint](https://saq-bol-api.onrender.com/health) before a live demonstration and wait for a response. Telegram updates alone do not wake a sleeping long poller. For continuous polling, the optional `deploy/render-telegram.yaml` defines a separately billed worker. To switch to that configuration, first turn off the embedded runner on the API. Real contact notifications require the recipient's explicit consent in Telegram.

### Private browser access

On Render, set `BCC_INTEGRATIONS_CIRCLE_WEB_OWNERS` to a JSON object mapping each verified private test chat ID to its assigned synthetic owner UUID. Each account must be assigned to exactly one allowlisted chat. The public Worker uses `BCC_CIRCLE_WEB_LOGIN=true`, the configured HTTPS origin, and its existing transfer API credential. Never copy the integration signing key to the public Worker.

In the private bot chat, send `/connect`. Enter the single-use code on the website under **Доверенные люди / Сенімді адамдар** within three minutes. A secure HttpOnly cookie grants access to that owner's contact list for 15 minutes. Signing out revokes the browser session. Removing the chat's assignment on Render revokes all its codes and sessions after the configuration takes effect. Adding a contact and enabling Telegram notifications require a separate invitation and consent.

Default: integrations disabled, Telegram fake, no token needed to start the core.
aiogram 3.31.0 was resolved against Python 3.12 and Pydantic 2.13.5 in `uv.lock`.
Compatibility sources: [PyPI](https://pypi.org/project/aiogram/3.31.0/) and
[aiogram documentation](https://docs.aiogram.dev/en/latest/).

1. Start PostgreSQL/Redis, run `uv sync` and `uv run alembic upgrade head` in backend.
2. Set `BCC_INTEGRATIONS_ENABLED=true` and a random signing key (at least 32 chars)
   in the process environment or an untracked backend `.env`.
3. Run `uv run python -m scripts.integration_token owner <synthetic-account-uuid>`.
   Treat its output as a secret. Issue `simulator` separately to the local test operator.
   There is deliberately no HTTP endpoint that grants owner/SOC/simulator identities.
4. Send `Authorization: Bearer <capability>` to integration routes. Create invitation,
   simulate `start` with the token and chat ID 123, then `consent` with the returned
   contact UUID, using the simulator credential. This is test evidence, not a real
   person's consent. Evaluate a synthetic cooling transfer through the existing API.
5. Queue a notification with the owner credential. Run
   `uv run python -m app.integrations.telegram.worker --once` (or without `--once`
   for continuous delivery processing). Inspect notification history. Fake mode never contacts Telegram.

For a separately authorized environment with consenting participants only, set:
`BCC_INTEGRATIONS_ENVIRONMENT=test`, `BCC_INTEGRATIONS_TELEGRAM_MODE=test`,
`BCC_INTEGRATIONS_TELEGRAM_TOKEN` and `BCC_INTEGRATIONS_TELEGRAM_ALLOWED_CHAT_IDS`.
Run `uv run python -m app.integrations.telegram.bot` and the worker in separate
processes. Polling trusts identities received from Telegram, accepts only private
allowlisted chats, and applies a Redis rate limit. No webhook is exposed.
Share `https://t.me/<your-test-bot>?start=<invitation-token>` privately. The recipient
must click consent; `/revoke <contact-uuid>` withdraws participation. The owner can
also revoke via API. Authorized RU/KK live acceptance was completed on 2026-11-14;
see [TELEGRAM_LIVE_ACCEPTANCE.md](TELEGRAM_LIVE_ACCEPTANCE.md) for actual delivery,
callback evidence and remaining controlled-only scenarios. That session is now stopped.

On the tested Windows workstation, the local helper protects the token as a DPAPI
SecureString inside a current-user-only ACL directory outside Git. It explicitly imports
the Security module from the running Windows PowerShell's PSHOME. Repair validates the
existing encrypted file without printing/decrypting its value and preserves history.
Only the authorized runtime decrypts into process memory/environment. Do not pass the
token in command arguments or chat, capture the secret prompt, or export private state.
Reusing a valid protected token does not require another secret entry. Starting a new
real acceptance session still requires a confirmed private recipient and scoped consent;
the completed session's send grant is closed. Avoid concurrent pollers for the same bot.

Rotate the signing key to invalidate demo capabilities. Never expose the simulator
credential to the mobile app. Disable integrations or use `telegram_mode=disabled`
to stop delivery. Do not publish `.env`, bot tokens, invitation links or CLI outputs.

Assistant feature branch, 18 November: the same polling process now registers localized
private-chat commands after acquiring its lock. `/menu`, `/status`, `/notifications`,
`/contacts`, `/check`, `/report`, `/reports`, `/safety`, `/privacy`, `/language`, `/cancel`
and `/help` are available. See [features, privacy and acceptance scope](../guardian/BOT_ASSISTANT_2026_11_18.md).
`/cancel` clears only the current draft; use `/contacts` and confirm to revoke consent.
The code is tested through the real dispatcher with a fake Telegram transport and the
18 November live menu acceptance in the feature report. Consent now opens the menu in
the same message. The completed test grant is closed; new real messages and unattended
polling still require a fresh scoped grant, as described above.

# Local fake Telegram and opt-in test bot

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
   for polling). Inspect notification history. Fake mode never contacts Telegram.

For a separately authorized environment with consenting participants only, set:
`BCC_INTEGRATIONS_ENVIRONMENT=test`, `BCC_INTEGRATIONS_TELEGRAM_MODE=test`,
`BCC_INTEGRATIONS_TELEGRAM_TOKEN` and `BCC_INTEGRATIONS_TELEGRAM_ALLOWED_CHAT_IDS`.
Run `uv run python -m app.integrations.telegram.bot` and the worker in separate
processes. Polling trusts identities received from Telegram, accepts only private
allowlisted chats, and applies a Redis rate limit. No webhook is exposed.
Share `https://t.me/<your-test-bot>?start=<invitation-token>` privately. The recipient
must click consent; `/revoke <contact-uuid>` withdraws participation. The owner can
also revoke via API. No real Telegram messages were sent during implementation.

Rotate the signing key to invalidate demo capabilities. Never expose the simulator
credential to the mobile app. Disable integrations or use `telegram_mode=disabled`
to stop delivery. Do not publish `.env`, bot tokens, invitation links or CLI outputs.

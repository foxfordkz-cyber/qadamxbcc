#!/bin/sh
# Continuous test runner for synthetic contacts. Start one copy for each bot.
set -eu

if [ "${BCC_INTEGRATIONS_ENABLED:-}" != true ] ||
   [ "${BCC_INTEGRATIONS_ENVIRONMENT:-}" != test ] ||
   [ "${BCC_INTEGRATIONS_TELEGRAM_MODE:-}" != test ]; then
  echo 'Enable the test integration environment to start Telegram.' >&2
  exit 1
fi

# Local operators can supply SQLAlchemy's async URL directly. A Render worker
# receives the same managed private DATABASE_URL as the API.
if [ -z "${BCC_DATABASE_URL:-}" ]; then
  case "${DATABASE_URL:-}" in
    postgresql://*|postgres://*) export BCC_DATABASE_URL="postgresql+asyncpg://${DATABASE_URL#*://}" ;;
    *) echo 'A PostgreSQL connection string is required.' >&2; exit 1 ;;
  esac
fi
: "${BCC_REDIS_URL:?A shared Key Value URL is required}"

# Validate the full allowlist and signing configuration before either process
# contacts Telegram. Configuration problems must never echo environment values.
if ! python -c 'from app.integrations.config import get_integration_settings; get_integration_settings()' 2>/dev/null; then
  echo 'Check the Telegram test token, signing key and consenting chat allowlist.' >&2
  exit 1
fi

exec python -m app.integrations.telegram.hosted

#!/bin/sh
# Render supplies a private Postgres URL. Keep credentials out of command arguments.
set -eu

: "${BCC_API_KEY:?Render transfer service key is required}"
: "${BCC_SOC_API_KEY:?Render SOC service key is required}"
: "${BCC_REDIS_URL:?Render Key Value URL is required}"
if [ "$BCC_API_KEY" = "$BCC_SOC_API_KEY" ]; then
  echo 'Transfer and SOC keys must be distinct.' >&2
  exit 1
fi

case "${DATABASE_URL:-}" in
  postgresql://*|postgres://*) export BCC_DATABASE_URL="postgresql+asyncpg://${DATABASE_URL#*://}" ;;
  *) echo 'Expected a Render PostgreSQL connection string.' >&2; exit 1 ;;
esac

alembic upgrade head
python -m scripts.bootstrap_demo
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-10000}"

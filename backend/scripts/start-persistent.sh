#!/bin/sh
set -eu
# Only the API pre-deploy job runs migrations and initial bootstrap.
case "${DATABASE_URL:-}" in
  postgresql://*|postgres://*) export BCC_DATABASE_URL="postgresql+asyncpg://${DATABASE_URL#*://}" ;;
  *) echo 'Managed PostgreSQL DATABASE_URL is required.' >&2; exit 1 ;;
esac
: "${BCC_REDIS_URL:?Shared Key Value is required}"
export BCC_MOBILE_EPHEMERAL_STORE=false BCC_RENDER_TELEGRAM_TEST=false
case "${1:-api}" in
  migrate)
    alembic upgrade head
    python -m scripts.bootstrap_demo
    ;;
  api)
    exec uvicorn app.mobile_gateway.app:factory --factory --host 0.0.0.0 --port "${PORT:-10000}"
    ;;
  worker)
    if [ "${BCC_INTEGRATIONS_TELEGRAM_MODE:-fake}" = test ]; then
      exec python -m app.integrations.telegram.hosted
    fi
    exec python -m app.integrations.worker
    ;;
  *) echo 'Expected api, migrate or worker.' >&2; exit 1 ;;
esac

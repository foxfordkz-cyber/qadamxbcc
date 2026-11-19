#!/bin/sh
# Start the Saq Bol demo: migrate, seed an empty database, run the API on loopback,
# then serve the site on $PORT. The API is reachable only through the site's proxy.
set -eu

PORT="${PORT:-3000}"

# Hosts hand out postgres:// or postgresql:// URLs; the app's driver is asyncpg.
if [ -z "${BCC_DATABASE_URL:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  BCC_DATABASE_URL=$(printf '%s' "$DATABASE_URL" | sed -E 's#^postgres(ql)?://#postgresql+asyncpg://#')
  export BCC_DATABASE_URL
fi
if [ -z "${BCC_REDIS_URL:-}" ] && [ -n "${REDIS_URL:-}" ]; then
  export BCC_REDIS_URL="$REDIS_URL"
fi

# The public HTTPS origin browsers use. Render and Railway announce it themselves.
if [ -z "${BCC_DEMO_PUBLIC_ORIGIN:-}" ]; then
  if [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
    export BCC_DEMO_PUBLIC_ORIGIN="$RENDER_EXTERNAL_URL"
  elif [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
    export BCC_DEMO_PUBLIC_ORIGIN="https://$RAILWAY_PUBLIC_DOMAIN"
  else
    unset BCC_DEMO_PUBLIC_ORIGIN
  fi
fi

cd /app/backend
alembic upgrade head
python -m scripts.bootstrap_demo
uvicorn app.main:app --host 127.0.0.1 --port 8000 &
API=$!

tries=0
until python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)" 2>/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -gt 180 ] || ! kill -0 "$API" 2>/dev/null; then
    echo "API did not become healthy" >&2
    exit 1
  fi
  sleep 1
done

cd /app/frontend
export BCC_API_MODE=live BCC_API_URL=http://127.0.0.1:8000
node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "$PORT" &
WEB=$!

# Stop the container when either process exits, so the host restarts it.
while kill -0 "$API" 2>/dev/null && kill -0 "$WEB" 2>/dev/null; do
  sleep 5
done
echo "A process exited; stopping" >&2
exit 1

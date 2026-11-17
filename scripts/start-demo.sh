#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker info >/dev/null
docker compose up -d --build --wait --wait-timeout 240
printf 'BCC Shield ready: http://localhost:%s\n' "${BCC_WEB_PORT:-3000}"
printf 'Synthetic data are created only for an empty database. Existing data are preserved.\n'

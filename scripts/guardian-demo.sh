#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/backend/.venv/bin/python" "$ROOT/backend/scripts/guardian_demo.py" "$@"

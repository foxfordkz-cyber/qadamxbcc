#!/usr/bin/env bash
# BCC Shield — single quality oracle. Exit code 0 == green.
#   backend : ruff (lint + format check), mypy --strict, pytest
#   frontend: tsc + build (only once frontend/package.json exists)
#   compose : docker compose config validation (only if docker CLI is present)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Avoid MSYS fork failures after native Node builds on Windows. The native runner
# executes the same checks and propagates any failing exit code.
if [[ "${OS:-}" == "Windows_NT" ]]; then
  exec powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$ROOT/verify.ps1"
fi
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required (https://docs.astral.sh/uv/)" >&2
  exit 1
fi

cd "$ROOT/backend"
step "backend: sync dependencies"
uv sync --quiet --python 3.12

step "backend: ruff check"
uv run --no-sync ruff check .
step "backend: ruff format --check"
uv run --no-sync ruff format --check .

step "backend: mypy --strict"
uv run --no-sync mypy --strict

step "backend: pytest"
uv run --no-sync pytest

if [[ -f "$ROOT/frontend/package.json" ]]; then
  cd "$ROOT/frontend"
  step "frontend: install"
  if [[ -f package-lock.json ]]; then npm ci --prefer-offline --no-audit --no-fund; else npm install --prefer-offline --no-audit --no-fund; fi
  step "frontend: type generation + tsc --noEmit"
  npm run typecheck
  if npm pkg get scripts.test | grep -q tsx; then
    step "frontend: tests"
    npm test
  fi
  step "frontend: build"
  npm run build
else
  step "frontend: skipped (frontend/package.json not present yet)"
fi

if command -v docker >/dev/null 2>&1; then
  step "docker compose config"
  docker compose -f "$ROOT/docker-compose.yml" config --quiet
fi

step "verify: ALL GREEN"

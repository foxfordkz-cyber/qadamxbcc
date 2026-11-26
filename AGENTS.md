# AGENTS.md — BCC Shield (ITU Hackathon 2026)

## Autonomous Execution Rules
1. Work 100% autonomously. NEVER ask for confirmation. If an architectural ambiguity arises, choose the most robust production approach, log it in `DECISIONS.md`, and proceed.
2. After EVERY task in `TODO.md`, run `./verify.sh`. A task is complete ONLY when `./verify.sh` exits with code `0`.
3. Create an atomic `git commit` after each completed task and mark `[x]` in `TODO.md`.

## Tech Stack & Constraints
- Backend: Python 3.12, FastAPI, SQLAlchemy 2.0 (async), PostgreSQL 16, Redis 7, Pydantic v2, NetworkX.
- Frontend: Next.js 14+ (App Router), TypeScript, Tailwind CSS, Lucide Icons, React Flow (`@xyflow/react`).
- Infra: Docker Compose (`db`, `redis`, `backend`, `frontend`).
- Quality Gates: `ruff check .`, `mypy --strict backend/app`, `pytest -q`, `npm run build`. No `random.uniform` in risk scoring; use deterministic graph + velocity + behavioral rules.
- Localization (CRITICAL): All UI text, labels, risk explanations, and cooling-off prompts MUST support bilingual **Kazakh (`kk`)** and **Russian (`ru`)** with a live language switcher (`ҚАЗ / РУС`) in the top header.``
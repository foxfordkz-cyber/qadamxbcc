# Saq Bol public demo: backend (FastAPI) and frontend (Next.js) in one container.
# PostgreSQL and Redis come from the host (Render Blueprint, Railway plugins or any VPS).
# Build from the repository root:  docker build -f deploy/Dockerfile -t saq-bol .

FROM node:22-bookworm-slim AS web
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    BCC_ENVIRONMENT=demo \
    BCC_BOOTSTRAP_DEMO=true \
    BCC_ALLOW_DEMO_OVERRIDES=true \
    BCC_NORMAL_SENDER_ID=00000000-0000-4000-8000-000000000001 \
    BCC_NORMAL_RECIPIENT_PHONE=+77010000002 \
    BCC_SCAM_SENDER_ID=00000000-0000-4000-8000-000000000001 \
    BCC_SCAM_RECIPIENT_PHONE=+77010000003 \
    BCC_HUB_SENDER_ID=00000000-0000-4000-8000-000000000001 \
    BCC_HUB_RECIPIENT_PHONE=+77010000004 \
    BCC_CARD_ACCOUNT_MAP='{"4400000000000002":"00000000-0000-4000-8000-000000000002","4400000000000003":"00000000-0000-4000-8000-000000000003","4400000000000004":"00000000-0000-4000-8000-000000000004"}'

RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY --from=web /usr/local/bin/node /usr/local/bin/node
RUN pip install --no-cache-dir "uv>=0.8"

WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/ ./
RUN python -m scripts.train_fraud_model

WORKDIR /app/frontend
COPY --from=web /web/package.json /web/next.config.ts ./
COPY --from=web /web/node_modules ./node_modules
COPY --from=web /web/.next ./.next
COPY --from=web /web/public ./public

COPY deploy/start.sh /app/start.sh
RUN chmod +x /app/start.sh
EXPOSE 3000
CMD ["/app/start.sh"]

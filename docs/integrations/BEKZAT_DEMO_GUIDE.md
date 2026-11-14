# Bekzat — three synthetic hackathon demos

Verified 2026-11-14 on source `e23df31514553990b59b9c0181046aff2c1c63fa`, [PR #3](https://github.com/foxfordkz-cyber/qadamxbcc/pull/3).
Use a fresh isolated demo database/volume and the existing core-owned synthetic seed.
There are no real money transfers, personal customer data, Telegram sends or NBK calls.
The new scenarios run through API/worker; frontend owners still wire the UI contracts.

## Reproducible setup

Set the existing approved local integration configuration in your shell: enabled=true,
telegram_mode=fake, a local signing key of at least 32 characters. Keep keys outside Git,
screenshots, command logs and the frontend bundle. The current audit reused its existing
untracked demo configuration without rotating or printing it. Do not use production data.

From the repository root in Bash, with those environment variables already loaded:

```bash
export COMPOSE_PROJECT_NAME=bcc-bekzat-demo-fresh
docker compose -f docker-compose.yml -f docker-compose.integrations.yml --profile integrations up -d --build --wait
docker compose exec -T backend python -m scripts.seed_bcc
docker compose restart backend
docker compose -f docker-compose.yml -f docker-compose.integrations.yml --profile integrations up -d --wait
cd backend
uv run python -m scripts.demo_integrations
```

Use a new project/volume for a new complete run; core velocity/history intentionally
persists. Do not rerun core seed over integration history: its core-table reset is not
an integration retention tool. Run only one project on the default host ports. Stop
only the explicitly selected disposable project when finished; never reset shared data.
Base Compose starts without Telegram credentials; the optional worker needs local
integration config. Existing running audit project: bcc-bekzat-final, five healthy services.
Frontend localhost:3000; API docs localhost:8000/docs. New integration UI is not included.

## DEMO 1 — normal transfer (about 20 seconds to explain)

The script calls the existing core normal preset. Expect `approved`; SOC advisory view
has `run:null`, `notifications:[]`, `external_checks:[]`. No trusted contact is contacted.
Explain: normal activity remains with the existing core decision; optional enrichment
does not introduce an automatic alert or a second transfer.

## DEMO 2 — social engineering (about 60 seconds to explain)

The script creates a synthetic invitation with explicit owner consent, binds fake chat
123 and independently confirms recipient consent. It calls the existing scam preset:
expect `cooling_off`. A separate integration POST requests contact + synthetic gateway.
The background worker sends through FakeTelegramAdapter; simulator reports suspicion.
SOC shows `SUSPICION_REPORTED`, the same correlation ID and `source:MOCK` evidence.
Core remains `cooling_off`; the script never calls resolve-cooling. Contact is revoked
in cleanup. Show invitation/consent state labels from ui_texts.json, not invitation tokens.

## DEMO 3 — suspicious network (about 50 seconds to explain)

The existing seeded hub preset yields `blocked`, bilingual core reasons and graph
evidence. Only after that decision, a separate gateway-only job checks SYN-NETWORK-001.
Expect `INDICATORS`, marker `SYNTHETIC_NETWORK_SIGNAL`, RU/KK descriptions and `MOCK`.
No contact notification is created; the core decision remains `blocked`. Join core
feed/reasons/graph and integration evidence by transaction_id. The fixture is not
evidence about a real person and is not an official NBK response.

## Observed results

| Scenario | Preserved core status | Transaction | Result |
|---|---|---|---|
| normal | approved | `95623625-753a-4aed-99a9-a116277f7e0b` | PASS |
| scam | cooling_off | `9f222096-9c0e-434e-9725-3126074aace1` | PASS |
| hub | blocked | `17ec8581-e437-4205-8b26-966fbaf7d7ec` | PASS |

The script emits safe JSON result lines only; a nonzero exit or missing PASS means
the demo failed, not that it should be narrated as successful. Readiness is GO only
for the verified fake flow. The script has bounded polling and raises on 401/429/503,
unexpected status or absent evidence. Observe Retry-After/default rate limits if
manually driving the APIs; use the complete request examples and owner/SOC separation.

## Troubleshooting and limits

- Wrong preset decision: use a fresh synthetic volume; do not edit core thresholds to force it.
- Worker not seen: check integrations/health with SOC capability and the worker container.
- Expired capability/invitation: obtain an authorized new demo session/invitation; do not bypass consent.
- Failed/uncertain delivery: show that status; do not resend blindly or call it delivered.
- Provider unavailable: show UNKNOWN/UNAVAILABLE; it cannot authorize or condemn a payment.
- No real Telegram delivery is claimed. An authorized consenting-recipient test remains BLOCKED.

See [frontend handoff](BEKZAT_FRONTEND_HANDOFF.md), [verification](BEKZAT_FINAL_VERIFICATION.md)
and [100-requirement audit](BEKZAT_90_PERCENT_AUDIT.md). Team merge waits for human review;
production remains NO-GO regardless of demo score.

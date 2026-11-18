#!/bin/bash
# fresh backend DB with a verified trusted contact "Мама"/"Анам"
pkill -f run_local_demo; sleep 2
cd /tmp/bek/backend && rm -rf ../.local-checks
export BCC_ENVIRONMENT=demo BCC_ALLOW_DEMO_OVERRIDES=true BCC_INTEGRATIONS_ENABLED=true BCC_INTEGRATIONS_TELEGRAM_MODE=fake BCC_INTEGRATIONS_SIGNING_KEY=demo-signing-key-0123456789-abcdefghij
(nohup uv run python -m scripts.run_local_demo --port 8011 > /tmp/bek.log 2>&1 &)
for i in $(seq 60); do grep -q "startup complete" /tmp/bek.log 2>/dev/null && break; sleep 2; done
S=00000000-0000-4000-8000-000000000001; A=http://127.0.0.1:8011/api/v1
OT=$(uv run python -m scripts.integration_token owner $S 2>/dev/null); ST=$(uv run python -m scripts.integration_token simulator 00000000-0000-4000-8000-0000000000aa --ttl 3600 2>/dev/null)
INV=$(curl -s -X POST $A/trusted-contacts -H "Authorization: Bearer $OT" -H "Content-Type: application/json" -d '{"owner_consent":true,"language":"kk"}')
TOK=$(echo $INV | python3 -c "import json,sys;print(json.load(sys.stdin)['invitation_token'])"); CID=$(echo $INV | python3 -c "import json,sys;print(json.load(sys.stdin)['contact']['id'])")
for b in "{\"kind\":\"start\",\"chat_id\":123,\"reference\":\"$TOK\"}" "{\"kind\":\"consent\",\"chat_id\":123,\"reference\":\"$CID\"}"; do curl -s -o /dev/null -X POST $A/trusted-contacts/simulator/update -H "Authorization: Bearer $ST" -H "Content-Type: application/json" -d "$b"; done
curl -s -o /dev/null -X PATCH $A/trusted-contacts/$CID/preferences -H "Authorization: Bearer $OT" -H "Content-Type: application/json" -d "{\"alias\":\"$1\",\"notifications_enabled\":true,\"language\":\"kk\"}"
echo "$ST" > /tmp/simtoken; echo reset-ok

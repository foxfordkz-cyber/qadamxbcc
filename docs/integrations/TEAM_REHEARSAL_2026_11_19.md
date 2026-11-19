# BCC Shield — team rehearsal and demo controls

19 November 2026. Owner: Bekzat. This adds local operator tooling on top of PR #14;
it does not merge main or complete the pending core/frontend acceptance.

## One-command operation

Prerequisites: Docker Desktop running, backend dependencies installed once with
`cd backend && uv sync --python 3.12`. Commands below run from the repository root.
Windows uses the existing backend virtual environment; Linux uses its equivalent.

| Purpose | Windows PowerShell | Linux/macOS |
|---|---|---|
| Build and start | `./scripts/guardian-demo.ps1 start` | `bash scripts/guardian-demo.sh start` |
| Read-only readiness | `./scripts/guardian-demo.ps1 check` | `bash scripts/guardian-demo.sh check` |
| Six synthetic E2E flows | `./scripts/guardian-demo.ps1 rehearse --reset-synthetic` | `bash scripts/guardian-demo.sh rehearse --reset-synthetic` |
| Stop and keep data | `./scripts/guardian-demo.ps1 stop` | `bash scripts/guardian-demo.sh stop` |
| Restart existing images | `./scripts/guardian-demo.ps1 start --no-build` | `bash scripts/guardian-demo.sh start --no-build` |

The JSON result has `success`, individual boolean checks, bounded queue counts and UTC
check time. Exit 0 means the requested operation passed; exit 1 means inspect the named
failure/check. `check` does not create containers, reseed data, send messages or install
dependencies. Health probes are bounded and run only on invocation; no background polling.
The authenticated integration health API retains its own cache/rate limit.

Open **http://localhost:13000**. Backend: `127.0.0.1:18000`; PostgreSQL: `127.0.0.1:15432`;
Redis: `127.0.0.1:16379`. Ports are intentionally separate from the team's default demo.
The fixed Docker project is `bcc-guardian-rehearsal`. A busy port causes a failure; the
tool never kills another process or changes another Docker project to free a port.

Readiness verifies all five container health checks, API readiness, real PostgreSQL/Redis,
worker heartbeat, enabled Fake Adapter, MOCK gateway, queue backlog/failures, frontend HTTP
and frontend proxy. A healthy process with queued/failed work is not labelled fully ready.
This is readiness for the local fake demo, not production certification or latency evidence.

## Isolation and recovery

The tool disables implicit `.env` loading and strips inherited BCC/Compose overrides.
It forces demo/local/fake configuration, an empty Telegram token and empty allowlist.
There is no polling service and no real Telegram provider call. It refuses containers
without the project marker, expected service name and current checkout ownership label.
Runtime drift into test/pilot/live settings is rejected before start/rehearse/probes.
Stopping our labelled containers remains possible even if their settings have drifted.

A fresh signing key is passed to Compose through stdin. No secret is placed in a command
argument, report, file or printed Docker error. On later start the key is recovered in
memory from our existing backend/worker containers, preserving their signed records.
Docker administrators can inspect container configuration: this is ordinary local demo
isolation, not a production secret vault. Removing the containers loses this key; this
tool therefore uses `stop`, never `down`, and preserves volumes.

`rehearse --reset-synthetic` deliberately discards ALL records in this project's PostgreSQL
public schema (including previous demo reports/consents) and Redis database 0. It stops API
and worker writers first, then reapplies migrations and bootstraps fresh synthetic fixtures
before running the existing six-flow driver. It must not be used as an archival environment.
Ordinary `start`, `check` and `stop` do not reseed an existing database. Interrupted startup
can be retried; run `check` afterwards. A partial startup is not reported as ready.

## Five-minute presentation

| Time | Presenter action | What the audience should see |
|---|---|---|
| 0:00–0:30 | Run readiness and explain scope | Local test environment; synthetic data; Fake Adapter |
| 0:30–1:15 | Show normal preset | Approved decision without a trusted-contact alert |
| 1:15–2:30 | Explain scam preset and fake E2E output | Cooling-Off, queued delivery, suspicion and saved SOC evidence |
| 2:30–3:15 | Show network preset | Suspicious recipient network and bilingual reasons; MOCK evidence labelled |
| 3:15–4:15 | Show Guardian receipt/SOC evidence | Explicit synthetic report and demo-operator status; advisory only |
| 4:15–5:00 | Show timeline/health contracts and limitations | Persistence, consent, no duplicate send; remaining team approvals |

Use `rehearse --reset-synthetic` immediately before presenting the deterministic API flows.
For interactive core presets afterwards, reset synthetic core fixtures in this owned stack
again rather than treating repeated transfers as identical first-time evaluations.
The current frontend does not yet provide the complete reviewed integration UI. Show
integration API evidence honestly; do not claim a unified mobile → Telegram → SOC screen
flow has passed joint team acceptance.

If Internet is unavailable, previously built images can start with `--no-build` and the
Fake Adapter runs locally. A first build may need Internet; this is not an offline installer.
Historical live Telegram acceptance is documented separately, including the closed grant.
Do not relabel fake delivery as a new real Telegram send. A future real session requires
its own scoped consent and the secure local live setup, not this fake-only operator tool.

## Team review and merge handoff

Verified remote main at preparation: `3d19e8e4fd92431e936fa68eb7728448a85b7105`.
PR #14 remains Draft/open and its CI was green before this tooling addition.
Recovery PR #10 remains Draft/open; GitHub reports a merge conflict. Its owner must review
that resolution. No team member's branch, frontend, financial logic or authorship is changed.

1. Damir reviews the redesign and agrees the main integration order.
2. Tanirbergen resolves/reviews recovery against that main; obtain the owner's merge approval.
3. Bring the new main and reviewed preparation into the top Bekzat stack; resolve conflicts,
   preserve migration histories and authorship, rerun API/migration/backend/frontend/Docker CI.
4. Review PR #14 and this dependent tooling PR. Their current bases document dependencies;
   do not merge the lower stack PRs individually or bypass the order with squash.
5. Frontend and core owners jointly accept consent/status/history, timeline/health and SOC
   evidence with their reviewed server-side capability boundary. Do not put tokens in browsers.
6. Record human approvals and actual end-to-end observations. Only then update D17/D18.

Matrix remains **99.50%: 98 DONE, D17/D18 BLOCKED**. No team approval is inferred from CI.
Local fake rehearsal is the technical deliverable; shared acceptance and production stay gated.

## Evidence

The final PR records the exact head, actual Windows/Linux results and CI links after execution.
Existing PR #14 results (447 backend cases, 64 frontend, six Docker flows, 81 browser checks)
remain scoped to that prior commit; new runs are not added together as unique tests.

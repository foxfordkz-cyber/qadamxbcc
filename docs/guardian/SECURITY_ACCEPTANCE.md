# Guardian security acceptance

Scope: local synthetic demonstration, fake Telegram HTTP, protected owner/SOC capabilities.
Previous live Telegram acceptance applies to the previous implementation only. Its grant
is closed. Guardian 2.0 has not sent live messages; new live acceptance requires separate
explicit permission and interaction in the confirmed test chat.

Implemented boundaries and regression evidence:

| Boundary | Evidence |
|---|---|
| Private allowlist, sender/chat match, no bank identity from chat | Guardian ingress and recipient-view tests |
| Independent consent, cap 3, one selected recipient | Circle concurrency/no-fanout tests; delivery regression suite |
| Opt-out/revocation checked before delivery | Circle queued-preference test, stale-session PostgreSQL regression |
| No retry on ambiguous delivery; bounded durable explicit Retry-After | Existing delivery/retry/crash-recovery tests remain required |
| Plain RU/KK UI, replay/expiry guards | Navigation and full Scam Check → report dispatcher tests |
| Explicit report confirmation; no automatic forwarding | Bot report tests assert zero rows before Submit |
| Owner/recipient/SOC separation and IDOR protection | Report API and bot foreign-chat/revocation tests |
| Quota/dedup under concurrent requests | Real PostgreSQL report replay/quota test |
| FSM survives restart, scoped keys and TTL | Real Redis storage-recreation test; not a live Telegram restart claim |
| Content minimization and retention | Secret/control/length rejection, 7/30-day cleanup tests |
| Deterministic advisory SOC view | Summary facts/auth/no-secret test and typed JSON contracts |

An initial Circle CI run exposed error-precedence drift: revoked consent returned the
new opt-out error. Checking consent first restored the existing contract; the regression
test was preserved, and Circle CI passed after the fix (8f98ad9).

Operational limits: current capabilities are integration demo auth, not bank IAM. There
has been no independent penetration test, production threat-model sign-off, official
bank integration or joint frontend acceptance. Free-text filtering is not a DLP guarantee.
Workers must be upgraded together with preference/report migrations. Demo SOC receipt
status is not an emergency response guarantee. No production GO is claimed.

Final measured QA evidence and exact source/CI references are recorded in
VERIFICATION.md after execution; historical counts must not be presented as new passes.

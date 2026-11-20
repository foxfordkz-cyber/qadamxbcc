import assert from "node:assert/strict";
import test from "node:test";
import { api, ApiError, validateApiResponse } from "../src/lib/contracts";
import { readSocDashboardSession, writeSocDashboardSession } from "../src/lib/soc-dashboard-session";

test("SOC reload recovers the selected workspace without persisting search names or case content", () => {
  const value = { mode: "cases" as const, selectedId: "00000000-0000-4000-8000-000000000001", filter: "cooling_off" as const, graphDepth: 2 as const };
  const raw = writeSocDashboardSession({ ...value, note: "private content", token: "secret", search: "customer name" } as typeof value);
  assert.deepEqual(readSocDashboardSession(raw), value);
  assert.doesNotMatch(raw, /private content|secret|customer name/);
  assert.equal(readSocDashboardSession('{"mode":"admin","selectedId":"../../escape"}').mode, "transfers");
  assert.equal(readSocDashboardSession("truncated").selectedId, null);
});

test("SOC transport preserves bounded Retry-After and never automatically retries an action", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ error: "rateLimited" }, { status: 429, headers: { "Retry-After": "61" } }); };
  try {
    await assert.rejects(api("integrations/guardian/soc/cases", { method: "POST", body: "{}" }),
      (error: unknown) => error instanceof ApiError && error.status === 429 && error.retryAfter === 61);
    assert.equal(requests, 1);
    await assert.rejects(api("integrations/health/details"), (error: unknown) => error instanceof ApiError && error.status === 429 && !!error.retryAfter);
    await assert.rejects(api("integrations/soc/transactions/00000000-0000-4000-8000-000000000002/summary"), (error: unknown) => error instanceof ApiError && error.status === 429);
    assert.equal(requests, 1, "changing widget or transaction must not bypass the shared SOC Retry-After");
  } finally { globalThis.fetch = original; }
});

test("SOC transport validates method-dependent case receipts and rejects mismatched case identity", () => {
  const caseId = "00000000-0000-4000-8000-000000000001";
  const receipt = { id: caseId, report_id: "00000000-0000-4000-8000-000000000002", source: "owner_demo", category: "safe_account", state: "NEW", assignee: null, version: 1,
    created_at: "2026-11-20T00:00:00Z", status_since: "2026-11-20T00:00:00Z", expires_at: "2026-11-21T00:00:00Z", demonstration_only: true };
  assert.deepEqual(validateApiResponse("integrations/guardian/soc/cases", receipt, "POST"), receipt);
  assert.throws(() => validateApiResponse("integrations/guardian/soc/cases", receipt), ApiError);
  assert.throws(() => validateApiResponse("integrations/guardian/soc/cases/00000000-0000-4000-8000-000000000003", receipt), ApiError);
});

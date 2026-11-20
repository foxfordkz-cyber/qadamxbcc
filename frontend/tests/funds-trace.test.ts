import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET, POST } from "../src/app/api/v1/[...path]/route";
import { ApiError, validateApiResponse } from "../src/lib/contracts";
import { staticApi } from "../src/lib/static-api";

const id = "00000000-0000-4000-8000-000000000001";
const next = "00000000-0000-4000-8000-000000000002";
const target = "00000000-0000-4000-8000-000000000003";
const route = `soc/transfers/${id}/funds-trace`;
const start = "2026-11-01T00:00:00Z";
const observed = "2026-11-02T00:00:00Z";
const link = { transaction_id: next, sender_id: id, recipient_id: target, settled_at: observed,
  transaction_amount: "300.60", allocated_amount: "50.25", first_hop: 1, last_hop: 1 };
const result = { transaction_id: id, recipient_id: id, status: "approved", amount: "50.25",
  currency: "KZT", settled_at: start, observed_until: observed, outcome: "possible_flow",
  window_hours: 24, max_hops: 3, max_candidates: 160, candidates_examined: 1,
  truncated: false, ambiguous_count: 0, first_hop_amount: "50.25", links: [link] };

test("funds trace binds the selected transaction and rejects inflated or malformed allocations", () => {
  assert.deepEqual(validateApiResponse(route, result), result);
  for (const patch of [{ transaction_id: next }, { first_hop_amount: "50.26" }, { links: [] },
    { links: [{ ...link, allocated_amount: "300.61" }] }, { status: "cooling_off" }, { candidates_examined: 161 }]) {
    assert.throws(() => validateApiResponse(route, { ...result, ...patch }), ApiError);
  }
});

test("offline funds trace explicitly requires a transaction database", async () => {
  for (const path of [route, `soc/accounts/${id}/trace-anchors`]) {
    await assert.rejects(staticApi(path), (error: unknown) => error instanceof ApiError && error.status === 501);
  }
});

test("pilot funds trace protects the ledger and validates its read-only upstream result", async t => {
  const origin = "https://shield.example.kz";
  const settings = {
    BCC_ENVIRONMENT: "pilot", BCC_API_MODE: "live", BCC_DEMO_ACTIONS_ENABLED: "false", BCC_MOBILE_LAN: "false",
    BCC_PUBLIC_ORIGIN: origin, BCC_PILOT_USER: "officer", BCC_PILOT_PASSWORD: "test-password-for-local-tests-only",
    BCC_API_KEY: "transfer-test-0123456789-ABCDEFGHIJKLM", BCC_SOC_API_KEY: "soc-test-9876543210-NOPQRSTUVWXYZabcd",
    BCC_API_URL: "http://backend.test", BCC_REQUEST_RATE_LIMIT_PER_MINUTE: "10000",
  };
  const previous = new Map(Object.keys(settings).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, settings);
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const url = `${origin}/api/v1/${route}`;
  const context = { params: Promise.resolve({ path: route.split("/") }) };
  const headers = { host: "shield.example.kz", origin, "content-type": "application/json", "x-bcc-soc-key": "browser-value",
    authorization: `Basic ${Buffer.from(`${settings.BCC_PILOT_USER}:${settings.BCC_PILOT_PASSWORD}`).toString("base64")}` };
  let responseId = id, count = 0;
  globalThis.fetch = async (upstream, init) => {
    count++;
    assert.equal(String(upstream), `${settings.BCC_API_URL}/api/v1/${route}`);
    assert.equal(new Headers(init?.headers).get("X-BCC-SOC-Key"), settings.BCC_SOC_API_KEY);
    assert.equal(new Headers(init?.headers).get("Authorization"), null);
    return Response.json({ ...result, transaction_id: responseId, private_details: "redacted" });
  };
  assert.equal((await GET(new NextRequest(url, { headers: { host: headers.host } }), context)).status, 401);
  assert.equal((await POST(new NextRequest(url, { headers, method: "POST" }), context)).status, 404);
  assert.equal(count, 0);
  const ok = await GET(new NextRequest(url, { headers }), context);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.deepEqual(await ok.json(), result);
  responseId = next;
  assert.equal((await GET(new NextRequest(url, { headers }), context)).status, 502);
});

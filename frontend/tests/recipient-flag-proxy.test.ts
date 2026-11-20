import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET, POST } from "../src/app/api/v1/[...path]/route";
import { proxySocIntegration } from "../src/lib/soc-integration-proxy";

test("anonymous hosted SOC reads synthetic feed and graph while private operations stay server-side", async t => {
  const origin = "https://shield.example.kz";
  const settings = {
    BCC_ENVIRONMENT: "demo", BCC_API_MODE: "live", BCC_REQUIRE_DEMO_UPSTREAM: "true",
    BCC_API_URL: "https://demo-api.example.kz", BCC_DEMO_PUBLIC_ORIGIN: origin,
    BCC_DEMO_UPSTREAM_API_KEY: "transfer-test-0123456789-ABCDEFGHIJKLM",
    BCC_DEMO_UPSTREAM_SOC_KEY: "soc-test-9876543210-NOPQRSTUVWXYZabcd",
  };
  const previous = new Map(Object.keys(settings).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, settings);
  t.after(() => { globalThis.fetch = originalFetch; for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const account = "00000000-0000-4000-8000-000000000001";
  const upstream: string[] = [];
  globalThis.fetch = async url => { upstream.push(String(url)); return Response.json({}); };
  for (const route of ["soc/feed", `soc/graph/${account}`]) {
    const get = new NextRequest(`${origin}/api/v1/${route}`);
    assert.equal((await GET(get, { params: Promise.resolve({ path: route.split("/") }) })).status, 200);
  }
  const post = (route: string) => new NextRequest(`${origin}/api/v1/${route}`, {
    method: "POST", headers: { origin, "content-type": "application/json", "x-bcc-soc-key": settings.BCC_DEMO_UPSTREAM_SOC_KEY }, body: "{}",
  });
  const flag = `soc/recipients/${account}/flag`;
  const history = ["soc", "recipients", account, "prior-receipts"];
  assert.equal((await GET(new NextRequest(`${origin}/api/v1/${history.join("/")}?version=1`), { params: Promise.resolve({ path: history }) })).status, 403);
  assert.equal((await POST(post(flag), { params: Promise.resolve({ path: flag.split("/") }) })).status, 403);
  for (const route of ["guardian/soc/cases", `guardian/soc/cases/${account}/actions`]) {
    const request = post(`integrations/${route}`);
    assert.equal((await proxySocIntegration(request, route.split("/"))).status, 403);
  }
  assert.deepEqual(upstream, ["soc/feed", `soc/graph/${account}`].map(route => `${settings.BCC_API_URL}/api/v1/${route}`));
});

test("flag BFF preserves uncertain success, validates input, and forwards only its own SOC credential", async t => {
  const settings = {
    BCC_ENVIRONMENT: "pilot", BCC_API_MODE: "live", BCC_DEMO_ACTIONS_ENABLED: "false", BCC_MOBILE_LAN: "false",
    BCC_PUBLIC_ORIGIN: "https://shield.example.kz", BCC_PILOT_USER: "officer",
    BCC_PILOT_PASSWORD: "test-password-for-local-tests-only",
    BCC_API_KEY: "transfer-test-0123456789-ABCDEFGHIJKLM", BCC_SOC_API_KEY: "soc-test-9876543210-NOPQRSTUVWXYZabcd",
    BCC_API_URL: "http://backend.test", BCC_REQUEST_RATE_LIMIT_PER_MINUTE: "10000",
  };
  const previous = new Map(Object.keys(settings).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, settings);
  t.after(() => { globalThis.fetch = originalFetch; for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const accountId = "00000000-0000-4000-8000-000000000001";
  const body = { flagged: true, note: "Synthetic review", request_id: "00000000-0000-4000-8000-000000000002", expected_version: 0 };
  const path = ["soc", "recipients", accountId, "flag"];
  const request = (raw = JSON.stringify(body)) => new NextRequest(`https://shield.example.kz/api/v1/${path.join("/")}`, {
    method: "POST", body: raw, headers: { host: "shield.example.kz", origin: settings.BCC_PUBLIC_ORIGIN,
      "content-type": "application/json", "x-bcc-soc-key": "untrusted-browser-key",
      authorization: `Basic ${Buffer.from(`${settings.BCC_PILOT_USER}:${settings.BCC_PILOT_PASSWORD}`).toString("base64")}` },
  });
  let calls = 0;
  let upstream = () => new Response("{", { status: 200, headers: { "content-type": "application/json" } });
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), `http://backend.test/api/v1/${path.join("/")}`);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-bcc-soc-key"), settings.BCC_SOC_API_KEY);
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("x-bcc-api-key"), null);
    assert.equal(init?.redirect, "manual");
    assert.deepEqual(JSON.parse(String(init?.body)), body);
    return upstream();
  };
  const invalidInput = await POST(request("{"), { params: Promise.resolve({ path }) });
  assert.equal(invalidInput.status, 422); assert.equal(calls, 0);
  const uncertain = await POST(request(), { params: Promise.resolve({ path }) });
  assert.equal(uncertain.status, 502); assert.deepEqual(await uncertain.json(), { error: "invalidResponse" }); assert.equal(calls, 1);
  upstream = () => Response.json({ detail: "flag_version_conflict" }, { status: 409 });
  const conflict = await POST(request(), { params: Promise.resolve({ path }) });
  assert.equal(conflict.status, 409); assert.deepEqual(await conflict.json(), { error: "flag_version_conflict" }); assert.equal(calls, 2);
  upstream = () => Response.json({ account_id: accountId, flagged: true, version: 1, updated_at: "2026-11-20T06:00:00Z", audit_id: body.request_id, actor: "test_soc_service", note: body.note, previous_flagged: false, secret_key: "private-upstream-value" });
  const success = await POST(request(), { params: Promise.resolve({ path }) });
  assert.equal(success.status, 200); assert.equal("secret_key" in await success.json(), false); assert.equal(calls, 3);
});

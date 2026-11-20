import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { caseActionSchema, caseSchema, incidentSummarySchema, socIntegrationSchema, validateSocIntegrationResponse } from "../src/lib/soc-integrations";
import { proxySocIntegration, resolveSocProxyRoute, safeSocProxyError, socCapability, socProxyAccess } from "../src/lib/soc-integration-proxy";

const caseId = "00000000-0000-4000-8000-000000000010";
const reportId = "00000000-0000-4000-8000-000000000011";
const otherId = "00000000-0000-4000-8000-000000000012";
const now = 1_800_000_000_000;
const token = `soc:${caseId}:1800000900:${"a".repeat(64)}`;
const settings = { BCC_ENVIRONMENT: "local", BCC_API_MODE: "live", BCC_SOC_CAPABILITY: token, BCC_API_URL: "http://127.0.0.1:8000" };
const caseValue = { id: caseId, report_id: reportId, source: "owner_demo", category: "impersonation", state: "NEW", assignee: null,
  version: 1, created_at: "2026-11-15T09:00:00Z", status_since: "2026-11-15T09:00:00Z", expires_at: "2026-12-15T09:00:00Z", demonstration_only: true };
const path = ["guardian", "soc", "cases", caseId, "actions"];
const action = { action: "assign", expected_version: 1, assignee: "demo_analyst_a" };
const key = "ABCDEF01-ABCD-4ABC-8ABC-ABCDEF012345";
const admit = () => ({ status: 200, retryAfter: 0 });

function request(method = "GET", headers: Record<string, string> = {}, body?: unknown, host = "localhost:3000", route = path.join("/")) {
  return new Request(`http://${host}/api/v1/integrations/${route}`, {
    method, headers: { host, ...(method === "POST" ? { "content-type": "application/json", origin: `http://${host}`, "idempotency-key": key } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("SOC schemas accept backend-generated examples for every supported operation", () => {
  const examples = JSON.parse(readFileSync(new URL("../../docs/integrations/api_examples.json", import.meta.url), "utf8")) as {
    path: string; method: string; status: number; path_parameters?: Record<string, string>; response: unknown;
  }[];
  let checked = 0;
  for (const example of examples) {
    const route = example.path.replace("/api/v1/", "").replace(/\{([^}]+)\}/g, (_, name: string) => example.path_parameters?.[name] ?? "missing");
    if (example.status >= 300 || !socIntegrationSchema(route)) continue;
    assert.doesNotThrow(() => validateSocIntegrationResponse(route, example.response, example.method), `${example.method} ${route}`);
    checked += 1;
  }
  assert.ok(checked >= 12, `Only checked ${checked} backend examples`);
});

test("case and incident contracts reject cross-resource or non-advisory receipts and strip extra fields", () => {
  assert.equal("signing_key" in caseSchema.parse({ ...caseValue, signing_key: "do not expose" }), false);
  assert.throws(() => caseSchema.parse({ ...caseValue, demonstration_only: false }));
  assert.throws(() => validateSocIntegrationResponse(`integrations/guardian/soc/cases/${otherId}`, caseValue));
  assert.throws(() => validateSocIntegrationResponse(`integrations/soc/transactions/${otherId}/timeline`, {
    transaction_id: caseId, as_of: caseValue.created_at, events: [], next_cursor: null, advisory_only: true,
  }));
  assert.equal(incidentSummarySchema.safeParse({ transaction_id: caseId }).success, false);
});

test("case action union requires version, disallows injected workflow fields and minimizes note contents", () => {
  assert.equal(caseActionSchema.safeParse(action).success, true);
  for (const value of [{ ...action, expected_version: 0 }, { ...action, bank_release: true }, { action: "cancel_transfer", expected_version: 1 }]) {
    assert.equal(caseActionSchema.safeParse(value).success, false);
  }
  for (const body of ["Секретный пароль", "номер карты 12345678", "номер карты ١٢٣٤٥٦٧٨", "link https://example.kz", "secret\u0000details", "word OTP disclosed"]) {
    assert.equal(caseActionSchema.safeParse({ action: "note", expected_version: 1, body }).success, false, body);
  }
  assert.equal(caseActionSchema.safeParse({ action: "note", expected_version: 1, body: "Тестовый звонок проверен оператором." }).success, true);
});

test("SOC capability is server-issued, bounded, role-specific and fails closed", () => {
  assert.equal(socCapability(settings, now), token);
  assert.deepEqual(socCapability({}, now), { status: 503, error: "integrationsUnavailable" });
  for (const value of [token.replace("soc:", "owner:"), `${token} `, token.replace("1800000900", "1800000000"), token.replace("1800000900", "1800003602"), "arbitrary-browser-bearer"]) {
    assert.deepEqual(socCapability({ BCC_SOC_CAPABILITY: value }, now), { status: 401, error: "integrationSessionExpired" });
  }
});

test("SOC boundary permits localhost including IPv6 and refuses public/LAN/proxy origin spoofing", () => {
  for (const host of ["localhost:3000", "127.0.0.1:3105", "[::1]:3105"]) {
    assert.equal(socProxyAccess(request("POST", {}, action, host), settings), null);
  }
  for (const host of ["shield.example.kz", "192.168.1.20:3000", "localhost.evil.test"]) {
    assert.equal(socProxyAccess(request("GET", {}, undefined, host), settings)?.status, 403);
  }
  const spoofedHeaders: Array<Record<string, string>> = [
    { origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }, { "x-forwarded-host": "evil.example" },
    { "x-forwarded-host": "localhost:3000, evil.example" }, { "x-forwarded-for": "127.0.0.1, 203.0.113.42" },
    { forwarded: "for=127.0.0.1;host=localhost:3000" }, { host: "localhost:65536" },
  ];
  for (const headers of spoofedHeaders) assert.equal(socProxyAccess(request("GET", headers), settings)?.status, 403);
  const noOrigin = request("POST", {}, action);
  noOrigin.headers.delete("origin");
  assert.equal(socProxyAccess(noOrigin, settings)?.status, 403);
  for (const overrides of [{ BCC_ENVIRONMENT: "pilot" }, { BCC_ENVIRONMENT: "demo", BCC_DEMO_PUBLIC_ORIGIN: "https://shield.example.kz" },
    { BCC_MOBILE_LAN: "true" }, { BCC_API_MODE: "demo" }, { NEXT_PUBLIC_BCC_STATIC: "1" }]) {
    assert.equal(socProxyAccess(request(), { ...settings, ...overrides })?.status, 503);
  }
});

test("proxy route/query allowlist bounds pages, keeps opaque cursors and forbids arbitrary operations", () => {
  assert.equal("status" in resolveSocProxyRoute(["guardian", "soc", "cases"], "GET", new URLSearchParams("limit=100&cursor=opaque%2Btoken%3D")), false);
  assert.equal("status" in resolveSocProxyRoute(["soc", "transactions", caseId, "timeline"], "GET", new URLSearchParams("limit=1")), false);
  for (const query of ["limit=101", "limit=0", "limit=1&limit=2", "status=NEW", "cursor=", "__proto__=1", "toString=1", `cursor=${"x".repeat(501)}`]) {
    assert.deepEqual(resolveSocProxyRoute(["guardian", "soc", "cases"], "GET", new URLSearchParams(query)), { status: 422, error: "invalid" });
  }
  for (const parts of [["guardian", "reports"], ["transactions", caseId], ["soc", "transactions", caseId, "release"], ["..", "soc", "feed"], ["guardian", "soc", "cases", "not-a-uuid"]]) {
    assert.equal("status" in resolveSocProxyRoute(parts, "POST", new URLSearchParams()), true);
  }
});

test("proxy forwards only server capability and exact idempotency key with strict body", async () => {
  let calls = 0;
  const response = await proxySocIntegration(request("POST", { authorization: "Bearer attacker", cookie: "session=private", "x-bcc-soc-key": "attacker" }, action), path, {
    env: settings, now: () => now, admit,
    fetch: async (url, init) => {
      calls += 1;
      assert.equal(String(url), `http://127.0.0.1:8000/api/v1/integrations/${path.join("/")}`);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), `Bearer ${token}`);
      assert.equal(headers.get("idempotency-key"), key);
      assert.equal(headers.get("cookie"), null);
      assert.equal(headers.get("x-bcc-soc-key"), null);
      assert.deepEqual(JSON.parse(String(init?.body)), action);
      assert.equal(init?.redirect, "error");
      return Response.json({ ...caseValue, assignee: action.assignee, version: 2, signing_key: "upstream-secret" });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal("signing_key" in await response.json(), false);
  assert.equal(calls, 1);
});

test("missing capability, invalid keys and unknown body fields never dispatch to backend", async () => {
  let calls = 0;
  const dependencies = { env: settings, now: () => now, admit, fetch: async () => { calls += 1; return Response.json(caseValue); } };
  assert.equal((await proxySocIntegration(request("GET", { authorization: `Bearer ${token}` }), path.slice(0, 4), { ...dependencies, env: { BCC_API_MODE: "live" } })).status, 503);
  assert.equal((await proxySocIntegration(request("POST", { "idempotency-key": "bad-key" }, action), path, dependencies)).status, 422);
  assert.equal((await proxySocIntegration(request("POST", {}, { ...action, bank_release: true }), path, dependencies)).status, 422);
  assert.equal(calls, 0);
});

test("proxy preserves only known status-matched errors and bounded Retry-After without automatic retries", async () => {
  let calls = 0;
  for (const [status, detail, expected] of [[409, "case_version_conflict", "case_version_conflict"], [409, "secret=private", "conflict"],
    [401, "internal token debug", "integrationSessionExpired"], [403, "wrong role details", "integrationForbidden"],
    [404, "case_not_found", "case_not_found"], [410, "case_expired", "case_expired"], [503, "signing_key=secret", "integrationsUnavailable"],
    [429, "integration rate limit", "rateLimited"]] as const) {
    const response = await proxySocIntegration(request("POST", {}, action), path, {
      env: settings, now: () => now, admit, fetch: async () => { calls += 1; return Response.json({ detail }, { status, headers: { "Retry-After": "60" } }); },
    });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: expected });
    assert.equal(response.headers.get("retry-after"), "60");
  }
  assert.equal(calls, 8);
  assert.equal(safeSocProxyError(400, "case_version_conflict"), "invalid");
  const response = await proxySocIntegration(request(), path.slice(0, 4), { env: settings, now: () => now, admit,
    fetch: async () => Response.json({ detail: "quota" }, { status: 429, headers: { "Retry-After": "99999999" } }) });
  assert.equal(response.headers.get("retry-after"), null);
});

test("invalid/mismatched upstream successes are never shown as a completed action", async () => {
  for (const value of [{ ...caseValue, id: otherId }, { ...caseValue, version: "new" }, { ...caseValue, demonstration_only: false }]) {
    const response = await proxySocIntegration(request("POST", {}, action), path, { env: settings, now: () => now, admit, fetch: async () => Response.json(value) });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "invalidResponse" });
  }
  const response = await proxySocIntegration(request("POST", {}, { report_id: otherId }, "localhost:3000", "guardian/soc/cases"), path.slice(0, 3), {
    env: settings, now: () => now, admit, fetch: async () => Response.json(caseValue, { status: 201 }),
  });
  assert.equal(response.status, 502);
});

import test from "node:test";
import assert from "node:assert/strict";
import { Gateway, gatewayOrigin, remainingSeconds } from "../www/gateway.mjs";
import { permittedExternal, PUBLIC_DEMO } from "../www/native.mjs";
test("gateway cannot take tokens to public, credentialed or path-bearing hosts", () => {
  for (const url of [
    "https://evil.example",
    "http://user:pass@10.0.0.1",
    "http://192.168.1.2/api",
    "http://10.1.1.1?key=a",
    "javascript:alert(1)",
    "http://192.168.1.999",
  ])
    assert.equal(gatewayOrigin(url), null);
  assert.equal(gatewayOrigin("192.168.1.2:18001"), null);
  assert.equal(
    gatewayOrigin("https://192.168.1.2:18001"),
    "https://192.168.1.2:18001",
  );
});
test("external pages are limited and do not use the native WebView", () => {
  assert.equal(permittedExternal(PUBLIC_DEMO), true);
  assert.equal(permittedExternal(PUBLIC_DEMO + "?token=leak"), false);
  assert.equal(permittedExternal("http://192.168.1.2:3000/mobile"), true);
  assert.equal(permittedExternal("http://192.168.1.2:3000/soc"), false);
});
test("login role comes from server and token is memory-only", async () => {
  const calls = [];
  const g = new Gateway("http://localhost:18001", async (url, options) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify({ token: "test-token", role: "admin" }),
      { status: 200 },
    );
  });
  await g.login("test-access-code");
  assert.equal(g.role, "admin");
  await g.api("soc/feed");
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-token");
  assert.equal(calls[1].options.redirect, "error");
  assert.equal(calls[1].options.credentials, "omit");
});
test("unknown delivery is surfaced once without automatic retry", async () => {
  let count = 0;
  const g = new Gateway("http://localhost:18001", async () => {
    count++;
    throw new Error("timeout");
  });
  await assert.rejects(
    g.api("transfers/evaluate", "POST", {}),
    (e) => e.status === 0,
  );
  assert.equal(count, 1);
});
test("cold starts extend only the sign-in request deadline", async () => {
  const timeouts = [];
  const g = new Gateway("http://localhost:18001", async (_url, _options, timeoutMs) => {
    timeouts.push(timeoutMs);
    return new Response("{}");
  });
  await g.request("/auth/login", "POST", {});
  await g.api("transfers/evaluate", "POST", {});
  assert.deepEqual(timeouts, [120000, 20000]);
});
test("expired session is cleared and 429 retains Retry-After", async () => {
  const g = new Gateway(
    "http://localhost:18001",
    async () => new Response("{}", { status: 401 }),
  );
  g.token = "x";
  g.role = "admin";
  await assert.rejects(g.api("soc/feed"), (e) => e.status === 401);
  assert.equal(g.token, null);
  g.fetcher = async () =>
    new Response("{}", { status: 429, headers: { "Retry-After": "60" } });
  await assert.rejects(g.api("soc/feed"), (e) => e.retryAfter === "60");
});
test("timer uses server deadline and is display-only", () => {
  const tx = {
    server_time: "2026-11-20T00:00:00Z",
    cooling_off_until: "2026-11-20T00:15:00Z",
  };
  assert.equal(remainingSeconds(tx, 1000, 1000), 900);
  assert.equal(remainingSeconds(tx, 1000, 31000), 870);
  assert.equal(remainingSeconds(tx, 1000, 1000000), 0);
  assert.equal(remainingSeconds({}, 0, 0), 0);
});

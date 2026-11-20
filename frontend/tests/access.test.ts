import assert from "node:assert/strict";
import test from "node:test";
import { accessConfiguration, backendHeaders, checkAccess } from "../src/lib/server-access";

test("hosted synthetic demo sends distinct service keys only with a complete HTTPS upstream configuration", () => {
  const hosted = {
    BCC_ENVIRONMENT: "demo", BCC_API_MODE: "live", BCC_REQUIRE_DEMO_UPSTREAM: "true",
    BCC_API_URL: "https://example-api.onrender.com", BCC_DEMO_PUBLIC_ORIGIN: "https://example.workers.dev",
    BCC_DEMO_UPSTREAM_API_KEY: "transfer-test-0123456789-ABCDEFGHIJKLM",
    BCC_DEMO_UPSTREAM_SOC_KEY: "soc-test-9876543210-NOPQRSTUVWXYZabcd",
  };
  assert.deepEqual(backendHeaders("transfers/evaluate", hosted), { "Content-Type": "application/json", "X-BCC-API-Key": hosted.BCC_DEMO_UPSTREAM_API_KEY });
  assert.deepEqual(backendHeaders("soc/feed", hosted), { "Content-Type": "application/json", "X-BCC-SOC-Key": hosted.BCC_DEMO_UPSTREAM_SOC_KEY });
  const post = (origin?: string) => new Headers({ "content-type": "application/json", ...(origin && { origin }) });
  const check = (headers: Headers) => checkAccess({ origin: "http://localhost", method: "POST", headers }, hosted);
  assert.equal(check(post(hosted.BCC_DEMO_PUBLIC_ORIGIN)), null);
  assert.equal(check(post())?.status, 403);
  assert.equal(check(post("https://wrong.example"))?.status, 403);
  for (const override of [
    { BCC_DEMO_UPSTREAM_API_KEY: undefined }, { BCC_DEMO_UPSTREAM_SOC_KEY: hosted.BCC_DEMO_UPSTREAM_API_KEY },
    { BCC_ENVIRONMENT: "local" }, { BCC_ENVIRONMENT: "pilot" }, { BCC_API_MODE: "demo" }, { BCC_MOBILE_LAN: "true" },
    { BCC_API_URL: "http://example-api.onrender.com" }, { BCC_API_URL: "https://example.org/alternate" },
    { BCC_API_URL: hosted.BCC_DEMO_PUBLIC_ORIGIN }, { BCC_DEMO_PUBLIC_ORIGIN: undefined },
  ]) assert.throws(() => backendHeaders("soc/feed", { ...hosted, ...override }));
});

const env = {
  BCC_ENVIRONMENT: "pilot", BCC_PUBLIC_ORIGIN: "https://shield.example.kz",
  BCC_API_MODE: "live", BCC_DEMO_ACTIONS_ENABLED: "false", BCC_PILOT_USER: "officer",
  BCC_PILOT_PASSWORD: "test-password-for-local-tests-only",
  BCC_API_KEY: "transfer-test-0123456789-ABCDEFGHIJKLM", BCC_SOC_API_KEY: "soc-test-9876543210-NOPQRSTUVWXYZabcd",
};
const auth = `Basic ${Buffer.from(`${env.BCC_PILOT_USER}:${env.BCC_PILOT_PASSWORD}`).toString("base64")}`;
const request = (headers: Record<string, string> = {}, method = "GET") => ({ origin: "http://frontend:3000", method, headers: new Headers(headers) });

test("pilot fails closed for missing configuration and demands credentials", () => {
  assert.equal(checkAccess(request(), { BCC_ENVIRONMENT: "pilot" })?.status, 503);
  assert.equal(checkAccess(request(), env)?.status, 401);
  assert.equal(checkAccess(request({ authorization: auth }), env), null);
  assert.equal(checkAccess(request({ authorization: "Basic Zm9vOmJhcg==" }), env)?.status, 401);
  assert.equal(checkAccess(request({ authorization: auth }), { ...env, BCC_API_MODE: "demo" })?.status, 503);
});

test("pilot rejects CSRF even with valid Basic credentials", () => {
  const headers = { authorization: auth, "content-type": "application/json", origin: env.BCC_PUBLIC_ORIGIN };
  assert.equal(checkAccess(request(headers, "POST"), env), null);
  assert.equal(checkAccess(request({ ...headers, origin: "https://evil.example" }, "POST"), env)?.status, 403);
  assert.equal(checkAccess(request({ authorization: auth, "content-type": "application/json" }, "POST"), env)?.status, 403);
  assert.equal(checkAccess(request({ ...headers, "content-type": "text/plain" }, "POST"), env)?.status, 415);
});

test("demo blocks cross-origin mutations and keeps backend role keys server-side", () => {
  assert.equal(checkAccess(request({ origin: "https://evil.example", "content-type": "application/json" }, "POST"), {})?.status, 403);
  assert.equal(checkAccess(request(), {}), null);
  assert.deepEqual(backendHeaders("transfers/evaluate", env), { "Content-Type": "application/json", "X-BCC-API-Key": env.BCC_API_KEY });
  assert.deepEqual(backendHeaders("soc/feed", env), { "Content-Type": "application/json", "X-BCC-SOC-Key": env.BCC_SOC_API_KEY });
});

test("local requests use their actual loopback Host despite Next URL normalization", () => {
  const headers = { host: "127.0.0.1:3105", origin: "http://127.0.0.1:3105", "content-type": "application/json" };
  assert.equal(checkAccess(request(headers, "POST"), {}), null);
  assert.equal(checkAccess(request({ ...headers, origin: "http://localhost:3105" }, "POST"), {})?.status, 403);
  assert.equal(checkAccess(request({ ...headers, host: "evil.example", origin: "https://evil.example" }, "POST"), {})?.status, 403);
  assert.equal(checkAccess(request({ ...headers, authorization: auth }, "POST"), env)?.status, 403);
});

test("unknown or missing environment cannot make a credentialed proxy anonymous", () => {
  for (const environment of [undefined, "", "production", "PILOT", "local", "demo"]) {
    const settings = { ...env, BCC_ENVIRONMENT: environment };
    assert.equal(checkAccess(request(), settings)?.status, 503, String(environment));
    assert.throws(() => backendHeaders("soc/feed", settings));
    assert.throws(() => accessConfiguration(settings));
  }
  for (const credential of ["BCC_API_KEY", "BCC_SOC_API_KEY", "BCC_PILOT_USER", "BCC_PILOT_PASSWORD"]) {
    for (const value of ["", " ", "secret"]) {
      assert.equal(checkAccess(request(), { BCC_ENVIRONMENT: "demo", [credential]: value })?.status, 503);
    }
  }
});

test("credential-free local demos remain usable in production Next builds", () => {
  for (const environment of [undefined, "local", "demo"]) {
    const settings = { NODE_ENV: "production", BCC_ENVIRONMENT: environment, BCC_API_MODE: "live" };
    assert.equal(checkAccess(request(), settings), null);
    assert.deepEqual(backendHeaders("soc/feed", settings), { "Content-Type": "application/json" });
  }
  for (const environment of ["", "production", "PILOT"]) {
    assert.equal(checkAccess(request(), { BCC_ENVIRONMENT: environment })?.status, 503);
  }
  assert.equal(checkAccess(request(), { BCC_API_MODE: "LIVE" })?.status, 503);
});

test("LAN demo trusts only its own private Wi-Fi Host, and only when enabled", () => {
  const headers = { host: "192.168.1.23:3105", origin: "http://192.168.1.23:3105", "content-type": "application/json" };
  assert.equal(checkAccess(request(headers, "POST"), {})?.status, 403);
  assert.equal(checkAccess(request(headers, "POST"), { BCC_MOBILE_LAN: "true" }), null);
  assert.equal(checkAccess(request({ ...headers, origin: "http://192.168.1.24:3105" }, "POST"), { BCC_MOBILE_LAN: "true" })?.status, 403);
  assert.equal(checkAccess(request({ ...headers, host: "8.8.8.8:3105", origin: "http://8.8.8.8:3105" }, "POST"), { BCC_MOBILE_LAN: "true" })?.status, 403);
  assert.equal(checkAccess(request({ ...headers, host: "shield.evil:3105", origin: "http://shield.evil:3105" }, "POST"), { BCC_MOBILE_LAN: "true" })?.status, 403);
  assert.equal(checkAccess(request({ ...headers, "sec-fetch-site": "cross-site" }, "POST"), { BCC_MOBILE_LAN: "true" })?.status, 403);
  assert.equal(checkAccess(request(), { BCC_MOBILE_LAN: "yes" })?.status, 503);
  assert.equal(checkAccess(request({ ...headers, authorization: auth }, "POST"), { ...env, BCC_MOBILE_LAN: "true" })?.status, 403);
});

test("hosted demo trusts only its configured public HTTPS origin behind the proxy", () => {
  const hosted = { BCC_ENVIRONMENT: "demo", BCC_API_MODE: "live", BCC_DEMO_PUBLIC_ORIGIN: "https://saq-bol.onrender.com" };
  // Next sees the proxy's internal URL; the browser sends the public origin.
  const internal = (headers: Record<string, string>) => checkAccess({ method: "POST", origin: "http://10.0.0.5:10000", headers: new Headers({ host: "saq-bol.onrender.com", "content-type": "application/json", ...headers }) }, hosted);
  assert.equal(internal({ origin: "https://saq-bol.onrender.com" }), null);
  assert.equal(internal({ origin: "https://evil.example" })?.status, 403);
  assert.equal(internal({ origin: "https://saq-bol.onrender.com", "sec-fetch-site": "cross-site" })?.status, 403);
  // The setting never travels with credentials, outside demo, or without HTTPS.
  assert.equal(checkAccess(request(), { ...hosted, BCC_API_KEY: "x".repeat(40) })?.status, 503);
  assert.equal(checkAccess(request(), { ...hosted, BCC_ENVIRONMENT: "local" })?.status, 503);
  assert.equal(checkAccess(request(), { ...hosted, BCC_DEMO_PUBLIC_ORIGIN: "http://saq-bol.onrender.com" })?.status, 503);
  assert.equal(checkAccess(request(), { ...hosted, BCC_DEMO_PUBLIC_ORIGIN: "https://saq-bol.onrender.com/path" })?.status, 503);
});

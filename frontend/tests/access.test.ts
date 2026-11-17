import assert from "node:assert/strict";
import test from "node:test";
import { backendHeaders, checkAccess } from "../src/lib/server-access";

const env = {
  BCC_ENVIRONMENT: "pilot", BCC_PUBLIC_ORIGIN: "https://shield.example.kz",
  BCC_API_MODE: "live", BCC_DEMO_ACTIONS_ENABLED: "false", BCC_PILOT_USER: "officer",
  BCC_PILOT_PASSWORD: "test-password-for-local-tests-only", BCC_API_KEY: "a".repeat(40), BCC_SOC_API_KEY: "b".repeat(40),
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

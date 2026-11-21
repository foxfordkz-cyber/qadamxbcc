import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/v1/[...path]/route";
import { demoPayee, payeeInput, payeeResult, recipientRef } from "../src/lib/payee-check";
import { validateApiResponse } from "../src/lib/contracts";

test("only published phone and card fixtures can be mapped to a beneficiary", () => {
  assert.equal(recipientRef("phone", "+7 (701) 000-00-02"), "normal");
  assert.equal(recipientRef("card", "4400 0000 0000 0004"), "hub");
  assert.equal(recipientRef("phone", "+77010005819"), null);
  assert.equal(recipientRef("iban", "4400000000000004"), null);
  assert.equal(payeeInput.safeParse({recipient: "+77010005819", bank: "bcc", expected_name: ""}).success, false);
});

test("name comparison only reflects the selected test bank and masked beneficiary", () => {
  const query = payeeInput.parse({recipient: "normal", bank: "bcc", expected_name: ""});
  assert.equal(demoPayee(query).status, "identified");
  assert.equal(demoPayee({...query, expected_name: " ДАНИЯР  а "}).status, "match");
  assert.equal(demoPayee({...query, expected_name: "Данияр"}).status, "close");
  assert.equal(demoPayee({...query, expected_name: "Данияр Б."}).status, "mismatch");
  const unavailable = demoPayee({...query, bank: "other"});
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.display_name, null);
  assert.deepEqual(validateApiResponse("payee-check", unavailable, "POST"), unavailable);
  assert.equal(payeeResult.safeParse({...unavailable, display_name: "Данияр А."}).success, false);
  assert.equal(payeeResult.safeParse({...demoPayee(query), display_name: "Данияр Асылов"}).success, false);
  assert.throws(() => validateApiResponse("payee-check", {...unavailable, phone: "+77010005819"}));
});

test("live public demo only forwards fixture refs and rejects a different beneficiary's response", async t => {
  const origin = "https://shield.example.kz", base = "https://api.example.kz";
  const settings = {
    BCC_ENVIRONMENT: "demo", BCC_API_MODE: "live", BCC_DEMO_ACTIONS_ENABLED: "true",
    BCC_REQUIRE_DEMO_UPSTREAM: "true", BCC_API_URL: base, BCC_DEMO_PUBLIC_ORIGIN: origin,
    BCC_DEMO_UPSTREAM_API_KEY: "transfer-test-0123456789-ABCDEFGHIJKLM",
    BCC_DEMO_UPSTREAM_SOC_KEY: "soc-test-9876543210-NOPQRSTUVWXYZabcd",
    BCC_NORMAL_SENDER_ID: "00000000-0000-4000-8000-000000000001",
    BCC_SCAM_SENDER_ID: "00000000-0000-4000-8000-000000000001",
    BCC_HUB_SENDER_ID: "00000000-0000-4000-8000-000000000001",
    BCC_NORMAL_RECIPIENT_PHONE: "+77010000002", BCC_SCAM_RECIPIENT_PHONE: "+77010000003", BCC_HUB_RECIPIENT_PHONE: "+77010000004",
  };
  const reset = new Map(Object.keys(settings).map(k => [k, process.env[k]]));
  const savedFetch = globalThis.fetch;
  Object.assign(process.env, settings);
  t.after(() => {
    globalThis.fetch = savedFetch;
    for (const [key, value] of reset) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const input = payeeInput.parse({recipient: "normal", bank: "bcc", expected_name: ""});
  const post = (body: object) => POST(new NextRequest(origin + "/api/v1/payee-check", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  }), {params: Promise.resolve({path: ["payee-check"]})});
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    assert.equal(String(url), base + "/api/v1/payee-check");
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    return Response.json(demoPayee({...input, recipient: "hub"}));
  };
  assert.equal((await post({...input, recipient: "+77010000099"})).status, 422);
  assert.equal(calls, 0);
  assert.equal((await post(input)).status, 502);
  assert.equal(calls, 1);
  process.env.BCC_DEMO_ACTIONS_ENABLED = "false";
  assert.equal((await post(input)).status, 404);
  assert.equal(calls, 1);
});

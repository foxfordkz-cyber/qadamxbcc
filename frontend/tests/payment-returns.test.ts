import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET, POST } from "../src/app/api/v1/[...path]/route";
import { validateApiResponse } from "../src/lib/contracts";
import { returnActionInput, reviewInput } from "../src/lib/payment-returns";
import { demoPresets } from "../src/lib/config";

const original = "11000000-0000-4000-b000-000000000001";
const another = "11000000-0000-4000-b000-000000000002";
const incoming = {
  original_id: original,
  received_at: "2026-11-20T08:00:00Z",
  amount: "18500.00",
  currency: "KZT",
  payer: { display_name: "Аян Д.", iban_masked: "KZ** •••• 4821" },
  review_state: "none",
  can_appeal: false,
  refund_transaction_id: null,
  refund_status: null,
};

test("return contracts bind the receipt to the source and accept explicit consent", () => {
  const action = { action: "return_to_sender", confirmed: true };
  assert.equal(returnActionInput.safeParse(action).success, true);
  for (const bad of [
    { ...action, recipient_id: another },
    { ...action, amount: "1" },
    { ...action, confirmed: "true" },
    { ...action, request_id: another },
  ])
    assert.equal(returnActionInput.safeParse(bad).success, false);
  assert.equal(reviewInput.safeParse({ decision: "clear", confirmed: true }).success, false);
  assert.deepEqual(validateApiResponse("returns/" + original, incoming), incoming);
  for (const bad of [
    { ...incoming, original_id: another },
    { ...incoming, refund_status: "approved" },
    { ...incoming, refund_transaction_id: original, refund_status: "approved" },
    { ...incoming, amount: "-1" },
  ])
    assert.throws(() => validateApiResponse("returns/" + original, bad));
  assert.throws(() => validateApiResponse("returns/incoming", { items: [incoming, incoming] }));
});

test("hosted return uses the transfer key and rejects public review, foreign origin, and destination changes", async (t) => {
  const origin = "https://demo.example.kz";
  const vars: Record<string, string> = {
    BCC_ENVIRONMENT: "demo",
    BCC_API_MODE: "live",
    BCC_REQUIRE_DEMO_UPSTREAM: "true",
    BCC_API_URL: "https://backend.example.kz",
    BCC_DEMO_PUBLIC_ORIGIN: origin,
    BCC_DEMO_UPSTREAM_API_KEY: "transfer-test-0123456789-ABCDEFGHIJKLM",
    BCC_DEMO_UPSTREAM_SOC_KEY: "soc-test-9876543210-NOPQRSTUVWXYZabcd",
    BCC_DEMO_ACTIONS_ENABLED: "true",
    BCC_EDGE_SUBMISSION_LIMITS: "true",
  };
  for (const [key, preset] of Object.entries(demoPresets)) {
    vars["BCC_" + key.toUpperCase() + "_SENDER_ID"] = preset.sender;
    vars["BCC_" + key.toUpperCase() + "_RECIPIENT_PHONE"] = preset.recipient;
  }
  const previous = new Map(Object.keys(vars).map((key) => [key, process.env[key]]));
  const beforeFetch = globalThis.fetch;
  Object.assign(process.env, vars);
  t.after(() => {
    globalThis.fetch = beforeFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const requests: [string, RequestInit | undefined][] = [];
  let output: unknown = { items: [incoming] };
  globalThis.fetch = async (url, init) => {
    requests.push([String(url), init]);
    return Response.json(output);
  };
  const list = "returns/incoming",
    path = "returns/" + original,
    review = "soc/returns/" + original + "/review";
  const get = async (route: string) =>
    GET(new NextRequest(origin + "/api/v1/" + route), {
      params: Promise.resolve({ path: route.split("?")[0].split("/") }),
    });
  const post = async (route: string, body: unknown, from = origin) =>
    POST(
      new NextRequest(origin + "/api/v1/" + route, {
        method: "POST",
        headers: {
          origin: from,
          "content-type": "application/json",
          "x-bcc-submission-source": "a".repeat(64),
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ path: route.split("/") }) },
    );
  assert.equal((await get(list)).status, 200);
  assert.equal((await get(list + "?owner=" + another)).status, 404);
  const action = { action: "return_to_sender", confirmed: true };
  assert.equal((await post(review, { decision: "clear", stage: "reported", confirmed: true })).status, 403);
  assert.equal((await post(path, action, "https://example.org")).status, 403);
  assert.equal((await post(path, { ...action, recipient_id: another })).status, 422);
  assert.equal(requests.length, 1);
  output = incoming;
  assert.equal((await post(path, action)).status, 200);
  const sent = new Headers(requests[1][1]?.headers);
  assert.equal(sent.get("X-BCC-API-Key"), vars.BCC_DEMO_UPSTREAM_API_KEY);
  assert.equal(sent.get("X-BCC-SOC-Key"), null);
  assert.equal(sent.get("X-BCC-Submission-Source"), "a".repeat(64));
  output = { ...incoming, original_id: another };
  assert.equal((await get(path)).status, 502);
  process.env.BCC_DEMO_ACTIONS_ENABLED = "false";
  assert.equal((await get(list)).status, 404);
});

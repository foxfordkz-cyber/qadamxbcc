import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { warningKeys } from "../src/lib/biometrics";
import type { Context, TransferInput } from "../src/lib/contracts";
import { evaluateDemo } from "../src/lib/demo";
import { ids } from "../src/lib/demo-ids";

const day = Date.parse("2026-11-20T09:00:00Z");
const midnight = Date.parse("2026-11-20T19:00:00Z"); // Asia/Almaty
const morning = Date.parse("2026-11-21T01:00:00Z");

function pay(amount: string, time: number, context: Partial<Context> = {}, recipient: string = ids.stranger) {
  const input: TransferInput = {
    sender_id: ids.sender, recipient_id: recipient, amount, currency: "KZT",
    context: { active_call: false, from_deposit: false, is_new_device: false, ...context },
  };
  return evaluateDemo(input, time);
}

beforeEach(() => {
  for (const key of ["bccDemoTransfers", "bccDemoDetails", "bccDemoRequests", "bccDemoAbandoned"]) {
    Reflect.deleteProperty(globalThis, key);
  }
});

test("only an explicit report adds a post-call warning for the first transfer", () => {
  const result = pay("22000", day, { payment_requested_after_call: true, is_new_recipient: false });
  assert.equal(result.status, "cooling_off");
  assert.equal(result.risk_score, 40);
  assert.equal(result.reasons.find(r => r.code === "POST_CALL_PAYMENT_REQUEST")?.evidence?.source, "customer_report");
  assert.deepEqual(warningKeys(result.context ?? {}, result.reasons), ["warningPostCallRequest"]);
  assert.deepEqual(warningKeys({ payment_requested_after_call: true }, []), ["warningGeneric"]);
});

test("a known payee stays approved after a call, including one established by a settled payment", () => {
  assert.equal(pay("22000", day, { payment_requested_after_call: true }, ids.friend).status, "approved");
  assert.equal(pay("22000", day).status, "approved");
  const repeat = pay("22000", day + 60_000, { payment_requested_after_call: true, is_new_recipient: true });
  assert.equal(repeat.status, "approved");
  assert.ok(repeat.reasons.every(r => r.code !== "POST_CALL_PAYMENT_REQUEST"));
});

test("an active call is distinct from an ended call where payment was requested", () => {
  const result = pay("22000", day, { active_call: true, payment_requested_after_call: true });
  assert.ok(result.reasons.some(r => r.code === "ACTIVE_CALL"));
  assert.ok(result.reasons.every(r => r.code !== "POST_CALL_PAYMENT_REQUEST"));
  assert.deepEqual(warningKeys(result.context ?? {}, result.reasons), ["warningCall"]);
});

test("both reasons are retained on a large first payment at midnight without stacking pauses", () => {
  const result = pay("120000", midnight, { payment_requested_after_call: true });
  assert.equal(result.status, "cooling_off");
  assert.equal(result.risk_score, 40);
  assert.equal(result.cooling_off_until, new Date(midnight + 900_000).toISOString());
  assert.deepEqual(warningKeys(result.context ?? {}, result.reasons), ["warningPostCallRequest", "warningNightSpike"]);
});

for (const [label, time, amount, expected] of [
  ["small nighttime payment", midnight, "119999.99", false],
  ["large first payment at 05:59", morning - 60_000, "120000", true],
  ["large first payment at 06:00", morning, "120000", false],
] as const) {
  test(label, () => {
    const result = pay(amount, time);
    assert.equal(result.status, expected ? "cooling_off" : "approved");
    assert.ok(result.reasons.some(r => r.code === "NEW_PAYEE_NIGHT_SPIKE") === expected);
    assert.deepEqual(warningKeys(result.context ?? {}, result.reasons), [expected ? "warningNightSpike" : "warningGeneric"]);
  });
}

import assert from "node:assert/strict";
import test from "node:test";
import { ids } from "../src/lib/config";
import { callCheckSchema, contextSchema, validateApiResponse } from "../src/lib/contracts";
import { bankCallDemo, callCheckDemo, DemoError, evaluateDemo } from "../src/lib/demo";

const scam = (check?: string) => ({
  sender_id: ids.sender, recipient_phone: "+77010000003", amount: "50000", currency: "KZT" as const,
  context: contextSchema.parse({ active_call: true, bank_call_check_id: check }),
});
const codes = (value: { reasons: { code: string }[] }) => value.reasons.map(r => r.code);

test("«bank is not calling» is a signed reason on the next transfer of the same customer", () => {
  const check = callCheckDemo(ids.sender);
  assert.equal(check.verified, false);
  assert.match(check.message_ru, /НЕ звонит/);
  assert.ok(callCheckSchema.safeParse(check).success);
  assert.ok(codes(evaluateDemo(scam(check.check_id))).includes("BANK_CALL_DENIED"));
  assert.ok(!codes(evaluateDemo(scam())).includes("BANK_CALL_DENIED"));
});

test("a real bank call is confirmed and never removes risk", () => {
  const now = Date.now();
  bankCallDemo(ids.sender, now);
  const check = callCheckDemo(ids.sender, now + 1000);
  assert.equal(check.verified, true);
  assert.equal(check.employee_name, "Асем Нурланова");
  const value = evaluateDemo(scam(check.check_id));
  assert.ok(!codes(value).includes("BANK_CALL_DENIED"));
  assert.ok(codes(value).includes("ACTIVE_CALL"));
});

test("a check belongs to one customer and unknown customers are rejected", () => {
  const check = callCheckDemo(ids.friend);
  assert.ok(!codes(evaluateDemo(scam(check.check_id))).includes("BANK_CALL_DENIED"));
  assert.throws(() => callCheckDemo("00000000-0000-4000-8000-0000000000ff"), DemoError);
});

test("the browser rejects a malformed call-check answer", () => {
  assert.throws(() => validateApiResponse("call-check", { verified: "yes" }));
});

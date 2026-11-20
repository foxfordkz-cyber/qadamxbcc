import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { cancelDemo, detailDemo, evaluateDemo, feedDemo, resolveDemo } from "../src/lib/demo";
import { ids } from "../src/lib/demo-ids";
import type { TransferInput } from "../src/lib/contracts";
import { warningKeys } from "../src/lib/biometrics";

const now = Date.parse("2026-11-20T09:00:00Z");
const clean = { caller_claims_bank_or_police: false, asked_to_move_to_safe_account: false, asked_to_keep_secret_or_install_app: false, initiated_by_customer: true, knows_recipient_personally: true };
function request(recipient_id: string = ids.stranger, overrides: Partial<TransferInput["context"]> = {}): TransferInput {
  return {
    request_id: crypto.randomUUID(), sender_id: ids.sender, recipient_id, amount: "1000", currency: "KZT",
    context: { active_call: false, from_deposit: false, is_new_device: false, ...overrides },
  };
}
const hold = (recipient: string = ids.stranger) => evaluateDemo(request(recipient, { active_call: true, from_deposit: true }), now);
beforeEach(() => {
  for (const name of ["bccDemoTransfers", "bccDemoDetails", "bccDemoRequests", "bccDemoAbandoned", "bccDemoRecipientFlags", "bccDemoFlagReceipts"]) Reflect.deleteProperty(globalThis, name);
});

test("fresh request with cleared browser flags cannot bypass the same recipient's pause", () => {
  const original = hold();
  const retry = request(ids.stranger, { is_new_recipient: false });
  const result = evaluateDemo(retry, now + 120000);
  assert.equal(result.status, "cooling_off"); assert.equal(result.risk_score, 40);
  assert.equal(result.cooling_off_until, original.cooling_off_until);
  assert.equal(result.reasons.find(reason => reason.code === "ACTIVE_HOLD_RETRY")?.evidence?.source, "local_demo");
  assert.match(result.headline_ru, /исходной паузы/);
  assert.deepEqual(warningKeys(result.context ?? {}, result.reasons), ["warningActiveHold"]);
  assert.deepEqual(evaluateDemo(retry, now + 180000), result, "idempotency replays the original receipt");
  assert.equal(feedDemo().stats.total, 2);
  assert.equal(detailDemo(original.transaction_id).risk_score, original.risk_score);
});

test("changing to an unfamiliar recipient is held despite caller-supplied known-recipient override", () => {
  const original = hold(ids.friend);
  const changed = evaluateDemo(request(ids.stranger, { is_new_recipient: false }), now + 1000);
  assert.equal(changed.status, "cooling_off"); assert.equal(changed.cooling_off_until, original.cooling_off_until);
  assert.equal(changed.reasons.find(reason => reason.code === "ACTIVE_HOLD_RETRY")?.evidence?.recipient_changed, true);
});

test("another previously known recipient and another sender remain independently evaluated", () => {
  hold();
  assert.equal(evaluateDemo(request(ids.friend), now + 1000).status, "approved");
  assert.equal(evaluateDemo({ ...request(ids.stranger), sender_id: ids.friend }, now + 1000).status, "approved");
});

test("a pause for the known recipient itself still applies to fresh retries", () => {
  const original = hold(ids.friend);
  const retry = evaluateDemo(request(ids.friend), now + 1000);
  assert.equal(retry.status, "cooling_off"); assert.equal(retry.cooling_off_until, original.cooling_off_until);
});

test("cancelled or expired roots no longer apply, and guarded descendants never restart the window", () => {
  const original = hold();
  const child = evaluateDemo(request(), now + 300000);
  const later = evaluateDemo(request(), now + 600000);
  assert.equal(child.cooling_off_until, original.cooling_off_until);
  assert.equal(later.cooling_off_until, original.cooling_off_until);
  cancelDemo(original.transaction_id, now + 610000);
  assert.equal(evaluateDemo(request(), now + 620000).status, "approved");
  assert.equal(detailDemo(child.transaction_id).status, "cooling_off", "cancellation does not mutate another intent");
  assert.equal(evaluateDemo(request(), now + 900000).status, "approved");
});

test("original deadline is inclusive and clean answers cannot release a guarded retry early", () => {
  const original = hold(); const child = evaluateDemo(request(), now + 800000);
  const deadline = Date.parse(original.cooling_off_until!);
  assert.equal(resolveDemo(child.transaction_id, clean, deadline - 1).status, "cooling_off");
  assert.equal(resolveDemo(child.transaction_id, clean, deadline).status, "approved");
  assert.equal(detailDemo(original.transaction_id).status, "cooling_off");
});

test("independent pressure retains a full new pause and hard network evidence retains its block", () => {
  hold();
  const later = now + 899000;
  const independent = evaluateDemo(request(ids.stranger, { active_call: true, from_deposit: true }), later);
  assert.equal(Date.parse(independent.cooling_off_until!), later + 900000);
  assert.ok(!independent.reasons.some(reason => reason.code === "ACTIVE_HOLD_RETRY"));
  assert.equal(evaluateDemo(request(ids.hub), later).status, "blocked");
});

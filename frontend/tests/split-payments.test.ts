import assert from "node:assert/strict";
import { test } from "node:test";
import { transferSchema } from "../src/lib/contracts";
import { evaluateDemo } from "../src/lib/demo";
import { ids } from "../src/lib/demo-ids";

const start = Date.UTC(2026, 10, 20, 9);
const hour = 3_600_000;
function payment(sender: string, recipient: string, amount = "50000") {
  return transferSchema.parse({
    request_id: crypto.randomUUID(), sender_id: sender, recipient_id: recipient, amount,
    context: { is_new_recipient: false },
  });
}

test("a new pair's third instalment requires confirmation and replays count once", () => {
  const first = payment(ids.sender, ids.stranger);
  assert.equal(evaluateDemo(first, start).status, "approved");
  assert.equal(evaluateDemo(first, start + hour).transaction_id, first.request_id);
  assert.equal(evaluateDemo(payment(ids.sender, ids.stranger), start + 2 * hour).status, "approved");
  const last = payment(ids.sender, ids.stranger);
  const result = evaluateDemo(last, start + 3 * hour);
  assert.equal(result.status, "cooling_off");
  assert.equal(evaluateDemo(last, start + 4 * hour).transaction_id, result.transaction_id);
  const signal = result.reasons.find(item => item.code === "SPLIT_TRANSFERS_24H");
  assert.equal(signal?.evidence?.settled_count, 2);
  assert.equal(signal?.evidence?.total_kzt, 150_000);
  assert.match(signal!.reason_kk, /24 сағат/);
  assert.match(signal!.reason_ru, /24 часа/);
});

test("established payees, the 24h boundary and one dominant purchase avoid split alerts", () => {
  for (const [sender, recipient, age, amounts] of [
    [ids.sender, ids.friend, 1, [50000, 50000, 50000]],
    [ids.friend, ids.stranger, 24, [50000, 50000, 50000]],
    [ids.stranger, ids.friend, 1, [1000, 1000, 160000]],
  ] as const) {
    evaluateDemo(payment(sender, recipient, String(amounts[0])), start - age * hour);
    evaluateDemo(payment(sender, recipient, String(amounts[1])), start - hour / 2);
    const last = evaluateDemo(payment(sender, recipient, String(amounts[2])), start);
    assert.ok(last.reasons.every(item => item.code !== "SPLIT_TRANSFERS_24H"));
  }
});

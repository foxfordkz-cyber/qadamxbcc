import test from "node:test";
import assert from "node:assert/strict";
import { groupAmount, rawAmount } from "../src/lib/amount";

test("amount is grouped like a banking app and keeps the raw value", () => {
  assert.equal(groupAmount("900000"), "900\u00a0000");
  assert.equal(groupAmount("25000.5"), "25\u00a0000,5");
  assert.equal(groupAmount(""), "");
  assert.equal(rawAmount("1\u00a0250\u00a0000"), "1250000");
  assert.equal(rawAmount("25 000,75"), "25000.75");
  assert.equal(rawAmount("12a"), null);
  assert.equal(rawAmount("1,234"), null);
  assert.equal(rawAmount(groupAmount("100000")), "100000");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { pilotDefaults, pilotEconomics } from "../src/lib/pitch-math";

test("pilot scenario counts only incremental capture and subtracts legitimate review costs", () => {
  const value = pilotEconomics(pilotDefaults);
  assert.equal(value.fraudulent, 500); assert.equal(value.baselineMisses, 300);
  assert.equal(value.additionalCases, 60); assert.equal(value.gross, 9_000_000);
  assert.equal(value.extraReviews, 999.5); assert.equal(value.reviewExpense, 799_600);
  assert.equal(value.net, 2_200_400);
});
test("no fraud, no additional capture or complete baseline never invent prevented loss", () => {
  for (const changed of [{ fraudRatePct: 0 }, { additionalCapturePct: 0 }, { baselineCapturePct: 100 }]) {
    const value = pilotEconomics({ ...pilotDefaults, ...changed });
    assert.equal(value.gross, 0); assert.ok(value.net <= 0);
  }
  assert.equal(pilotEconomics({ ...pilotDefaults, reviewCost: 0, annualCost: 0 }).roiPct, null);
});
test("invalid assumptions cannot produce NaN, negative costs or out-of-range rates", () => {
  for (const invalid of [NaN, Infinity, -1, 101]) assert.throws(() => pilotEconomics({ ...pilotDefaults, extraHoldPct: invalid }), RangeError);
  assert.throws(() => pilotEconomics({ ...pilotDefaults, transfers: 1e12 }), RangeError);
  assert.ok(pilotEconomics({ ...pilotDefaults, extraHoldPct: 1 }).net < pilotEconomics(pilotDefaults).net);
});

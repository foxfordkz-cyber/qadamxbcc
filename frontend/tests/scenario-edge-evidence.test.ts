import assert from "node:assert/strict";
import test from "node:test";
import { edgeReceiptSchema } from "../src/lib/edge-receipts";
import { estimatePolicy } from "../src/lib/scenario-policy";
import samples from "../src/lib/scenario-details.json";

test("shadow evaluation preserves original holds, adds pauses inclusively and sums exact tiyn", () => {
  assert.deepEqual(estimatePolicy(samples, null), {
    missed: 3, honestHeld: 4,
    missedTiyn: samples.filter(r => r.fraud && r.decision === "approved").reduce((n,r) => n+r.amount_tiyn,0),
    honestHeldTiyn: samples.filter(r => !r.fraud && r.decision !== "approved").reduce((n,r) => n+r.amount_tiyn,0),
  });
  assert.deepEqual(estimatePolicy([
    {fraud:true, decision:"approved", score:30, amount_tiyn:7025},
    {fraud:false, decision:"blocked", score:10, amount_tiyn:130},
    {fraud:false, decision:"approved", score:30, amount_tiyn:799},
  ], 30), {missed:0, honestHeld:2, missedTiyn:0, honestHeldTiyn:929});
});

test("ledger cutoffs retain microseconds and exclude the decision instant", () => {
  const id = (n:number) => "00000000-0000-4000-8000-"+String(n).padStart(12,"0");
  const stamp = "2026-11-21T10:00:00.123456Z";
  const page = {transaction_id:id(1), source:id(2), target:id(3), has_more:false,
    from_time:"2026-11-20T10:00:00.123456Z", before_time:stamp,
    items:[{transaction_id:id(4), amount:"57.10", settled_at:"2026-11-21T15:00:00.123455+05:00"}]};
  assert.equal(edgeReceiptSchema.safeParse(page).success, true);
  assert.equal(edgeReceiptSchema.safeParse({...page, items:[{...page.items[0], settled_at:stamp}]}).success, false);
});

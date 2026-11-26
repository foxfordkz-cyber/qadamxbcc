import assert from "node:assert/strict";
import test from "node:test";
import contract from "../src/lib/demo-decision-contract.json";
import { transferSchema } from "../src/lib/contracts";
import { cancelDemo, evaluateDemo } from "../src/lib/demo";
import { demoPresets } from "../src/lib/config";

test("website fixtures agree with the real backend's decision, score and full rule set", () => {
  // Later paid examples must not acquire a previous case's unresolved hold.
  for (const row of contract.cases) {
    const result = evaluateDemo(transferSchema.parse({sender_id: contract.sender_id, recipient_id:row.recipient_id, amount:row.amount, context:row.context}), Date.parse(contract.timestamp));
    assert.deepEqual([result.status, result.risk_score, result.reasons.map(r => r.code).sort()], [row.status, row.score, row.codes], row.name);
    if (result.status === "cooling_off") cancelDemo(result.transaction_id);
  }
  for (const [name, preset] of Object.entries(demoPresets)) {
    const row = contract.cases.find(c => c.name === name)!;
    assert.equal(preset.amount,row.amount);
    assert.equal(preset.sender,contract.sender_id);
    assert.equal(preset.recipient.slice(-1),row.recipient_id.slice(-1));
    assert.deepEqual(preset.context,row.context);
  }
});

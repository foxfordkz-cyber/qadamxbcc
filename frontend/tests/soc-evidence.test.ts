import assert from "node:assert/strict";
import { test } from "node:test";
import { demoPresets, ids } from "../src/lib/config";
import { transferSchema } from "../src/lib/contracts";
import { evaluateDemo, feedDemo, graphDemo } from "../src/lib/demo";
import { countBlockedHubs } from "../src/lib/feed-summary";

test("hub evidence discovered at final recheck counts once alongside initial decisions", () => {
  const form = demoPresets.hub;
  const decision = evaluateDemo(transferSchema.parse({ sender_id: form.sender, recipient_phone: form.recipient, amount: form.amount, context: form.context }));
  const initial = feedDemo({ q: decision.transaction_id }).items[0];
  for (const code of ["RECHECK_DROP_HUB_FAN_IN", "RECHECK_RECIPIENT_MANY_SENDERS"]) {
    const rechecked = { ...initial, transaction_id: crypto.randomUUID(), reasons: [{ ...initial.reasons[0], code }] };
    assert.equal(countBlockedHubs([rechecked]), 1);
    assert.equal(countBlockedHubs([initial, rechecked]), 1);
    assert.equal(countBlockedHubs([{ ...rechecked, status: "cooling_off" }]), 0);
    assert.equal(countBlockedHubs([{ ...rechecked, status: "cancelled" }]), 0);
  }
  const unrelated = { ...initial, reasons: [{ ...initial.reasons[0], code: "RECHECK_SOCIAL_ENGINEERING_PATTERN" }] };
  assert.equal(countBlockedHubs([unrelated]), 0);
});

test("every demo account has a graph with unique nodes and valid non-self edges", () => {
  for (const center of Object.values(ids)) {
    const graph = graphDemo(center);
    const nodes = new Set(graph.nodes.map(node => node.id));
    assert.equal(graph.center, center);
    assert.equal(nodes.size, graph.nodes.length, `duplicate nodes for ${center}`);
    assert.equal(graph.nodes.filter(node => node.data.depth === 0).length, 1);
    assert.equal(graph.nodes.find(node => node.data.depth === 0)?.id, center);
    assert.equal(new Set(graph.edges.map(edge => edge.id)).size, graph.edges.length);
    for (const edge of graph.edges) {
      assert.ok(nodes.has(edge.source));
      assert.ok(nodes.has(edge.target));
      assert.notEqual(edge.source, edge.target, `self edge for ${center}`);
    }
  }
});

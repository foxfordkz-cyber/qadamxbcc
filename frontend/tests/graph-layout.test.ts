import assert from "node:assert/strict";
import { test } from "node:test";
import { ids } from "../src/lib/config";
import { validateApiResponse, type Graph } from "../src/lib/contracts";
import { graphDemo } from "../src/lib/demo";
import { directGraphLayout } from "../src/lib/graph-layout";

test("direct fan-in layout keeps all twelve senders, hub and shared account without node overlap", () => {
  const graph = graphDemo(ids.hub, 1);
  const before = structuredClone(graph);
  const nodes = directGraphLayout(graph);
  assert.equal(nodes.length, 14);
  assert.deepEqual(new Set(nodes.map(node => node.id)), new Set(graph.nodes.map(node => node.id)));
  assert.deepEqual(graph, before);
  for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
    assert.ok(Math.abs(nodes[a].position.x - nodes[b].position.x) >= 200 || Math.abs(nodes[a].position.y - nodes[b].position.y) >= 104, `${nodes[a].id} overlaps ${nodes[b].id}`);
  }
  const positionMap = (items: Graph["nodes"]) => Object.fromEntries(items.map(node => [node.id, node.position]));
  assert.deepEqual(positionMap(directGraphLayout({ ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() })), positionMap(nodes));
  const incoming = graph.edges.filter(edge => edge.data.edge_type === "transfer" && edge.target === graph.center);
  assert.equal(incoming.length, 12);
  assert.ok(incoming.every(edge => nodes.find(node => node.id === edge.source)!.position.x < 0));
  assert.ok(nodes.find(node => node.id === "shared-account")!.position.x > 0);
});

test("expanded graph retains API positions and responses must match the requested depth", () => {
  const expanded = graphDemo(ids.hub, 2);
  assert.equal(directGraphLayout(expanded), expanded.nodes);
  const direct = graphDemo(ids.hub, 1);
  assert.doesNotThrow(() => validateApiResponse(`soc/graph/${ids.hub}?depth=1`, direct));
  assert.doesNotThrow(() => validateApiResponse(`soc/graph/${ids.hub}?depth=2`, expanded));
  assert.throws(() => validateApiResponse(`soc/graph/${ids.hub}?depth=1`, expanded));
  assert.doesNotThrow(() => validateApiResponse(`soc/graph/${ids.hub}`, expanded));
});

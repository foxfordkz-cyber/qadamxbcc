import assert from "node:assert/strict";
import { test } from "node:test";
import { TransferSelection } from "../src/lib/transfer-selection";

test("startup restores one receipt and subsequent recovery does not select another", () => {
  const selection = new TransferSelection();
  assert.equal(selection.acceptsRecovery("first-held"), true);
  assert.equal(selection.acceptsRecovery("other-held"), false);
  assert.equal(selection.id, "first-held");
  assert.equal(selection.acceptsRecovery("first-held"), true);
});

test("a pending unknown result may recover before any result is displayed", () => {
  const selection = new TransferSelection();
  selection.select("pending-request");
  assert.equal(selection.acceptsRecovery("older-held"), false);
  assert.equal(selection.acceptsRecovery("pending-request"), true);
  assert.equal(selection.id, "pending-request");
});

test("reviewing A prevents the last attempted B from taking over in either response order", () => {
  for (const responseOrder of [["A", "B"], ["B", "A"]]) {
    const selection = new TransferSelection();
    selection.select("B");
    selection.select("A");
    const displayed = responseOrder.filter(id => selection.acceptsRecovery(id));
    assert.deepEqual(displayed, ["A"]);
    assert.equal(selection.id, "A");
  }
});

test("a response started before a later review is checked against the latest selection", async () => {
  const selection = new TransferSelection();
  selection.select("B");
  let complete!: (id: string) => void;
  const read = new Promise<string>(resolve => { complete = resolve; });
  const response = read.then(id => selection.acceptsRecovery(id));
  selection.select("A");
  complete("B");
  assert.equal(await response, false);
  assert.equal(selection.id, "A");
});

test("editing a draft or explicitly starting again keeps an empty result despite late recovery", async () => {
  for (const initial of [null, "held-transfer"]) {
    const selection = new TransferSelection();
    if (initial !== null) selection.select(initial);
    let complete!: (id: string) => void;
    const read = new Promise<string>(resolve => { complete = resolve; });
    const response = read.then(id => selection.acceptsRecovery(id));
    selection.select(null);
    complete("held-transfer");
    assert.equal(await response, false);
    assert.equal(selection.id, null);
    assert.equal(selection.acceptsRecovery("another-held"), false);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  restore,
  addTransfer,
  cancelTransfer,
  safetyResult,
} from "../www/demo.mjs";
import { COPY } from "../www/copy.mjs";
test("corrupt and unknown storage starts safely", () => {
  for (const raw of ["invalid", "null", "{}", '{"version":3,"transfers":[]}'])
    assert.deepEqual(restore(raw), initialState());
});
test("restoring storage whitelists fields and rejects invented decisions", () => {
  const state = restore(
    JSON.stringify({
      version: 1,
      language: "bad",
      welcomed: true,
      token: "secret",
      transfers: [
        { id: "a", preset: "pressure", status: "approved", createdAt: 1 },
        {
          id: "b",
          preset: "pressure",
          status: "cooling_off",
          createdAt: 1,
          description: "do not retain",
        },
        { id: "<script>", preset: "network", status: "blocked", createdAt: 1 },
      ],
    }),
  );
  assert.equal(state.language, "kk");
  assert.equal(state.transfers.length, 1);
  assert.equal(state.transfers[0].description, undefined);
  assert.equal(state.token, undefined);
});
test("three distinct fixtures, duplicate IDs and bounded history", () => {
  let state = initialState();
  for (const [i, preset] of ["everyday", "pressure", "network"].entries())
    state = addTransfer(state, preset, `id-${i}`);
  assert.deepEqual(
    state.transfers.map((t) => t.status),
    ["blocked", "cooling_off", "approved"],
  );
  assert.equal(addTransfer(state, "everyday", "id-1"), state);
  for (let i = 0; i < 50; i++)
    state = addTransfer(state, "everyday", `extra-${i}`);
  assert.equal(state.transfers.length, 30);
});
test("only cooling can cancel; cancellation never approves", () => {
  let s = addTransfer(
    addTransfer(initialState(), "everyday", "a"),
    "pressure",
    "b",
  );
  s = cancelTransfer(cancelTransfer(s, "a"), "b");
  assert.equal(s.transfers[0].status, "cancelled");
  assert.equal(s.transfers[1].status, "approved");
  assert.deepEqual(cancelTransfer(s, "b"), s);
});
test("education needs all answers, and no-signal result never means safe", () => {
  assert.equal(safetyResult([true]), null);
  assert.equal(safetyResult([false, false, "no"]), null);
  assert.equal(safetyResult([false, false, false]), "aware");
  assert.equal(safetyResult([true, false, false]), "pause");
});
test("Russian and Kazakh cover identical interface keys", () =>
  assert.deepEqual(Object.keys(COPY.ru).sort(), Object.keys(COPY.kk).sort()));

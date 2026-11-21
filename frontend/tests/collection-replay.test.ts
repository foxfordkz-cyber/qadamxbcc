import assert from "node:assert/strict";
import test from "node:test";
import { collectionReplay, readReplaySelection } from "../src/lib/collection-replay";

test("an SOC replay link opens exactly one published account and checkpoint", () => {
  for (const account of ["a", "b"] as const) {
    collectionReplay.checkpoints.forEach((checkpoint, index) => {
      const link = readReplaySelection(`${account}-${index + 1}`);
      assert.deepEqual(link, { account, index, checkpoint });
    });
  }
  for (const invalid of [null, "", "c-1", "a-0", "a-01", "b-1.5", "b-100", "a-1/b-2"]) {
    assert.equal(readReplaySelection(invalid), null);
  }
  assert.equal(readReplaySelection(`a-${collectionReplay.checkpoints.length + 1}`), null);
});

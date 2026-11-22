import assert from "node:assert/strict";
import test from "node:test";
import { accounts, collectionReplay, readReplaySelection, replayPostings } from "../src/lib/collection-replay";

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

test("the source transfers reconcile to each isolated checkpoint without future or hypothetical payments", () => {
  for (const account of accounts) {
    for (const step of collectionReplay.checkpoints) {
      const rows = replayPostings(account, step.evaluated_at);
      assert.ok(rows);
      const incoming = rows.filter(row => row.recipient === "recipient");
      const outgoing = rows.filter(row => row.sender === "recipient");
      assert.equal(new Set(incoming.map(row => row.sender)).size, step[account].senders);
      assert.equal(incoming.reduce((sum, row) => sum + row.amount, 0), step[account].received);
      assert.equal(outgoing.reduce((sum, row) => sum + row.amount, 0), step[account].forwarded);
      assert.equal(new Set(rows.map(row => row.tx_id)).size, rows.length);
      assert.ok(rows.every(row => row.tx_id !== "probe" && Date.parse(row.occurred_at) <= Date.parse(step.evaluated_at)));
    }
  }
});

test("only relevant postings support a signal and a model estimate never receives a transaction attribution", () => {
  const at = collectionReplay.checkpoints.at(-1)!.evaluated_at;
  const transit = replayPostings("b", at, "RECIPIENT_TRANSIT_RATIO");
  assert.ok(transit);
  assert.equal(transit.length, 13);
  assert.deepEqual([transit[0].tx_id, transit[0].amount, transit[0].recipient], ["out", 150_000, "next"]);
  assert.equal(replayPostings("a", at, "FAN_IN_UNCORROBORATED")?.some(row => row.tx_id === "out"), false);
  assert.equal(replayPostings("b", at, "DROP_HUB_FAN_IN")?.length, 12);
  assert.equal(replayPostings("b", at, "ML_RISK_UPLIFT"), null);
  assert.equal(replayPostings("b", at, "UNKNOWN"), null);
  assert.equal(replayPostings("b", "2026-11-20T15:05:00+05:00", "RECIPIENT_INSTANT_CASHOUT")?.length, 7);
});

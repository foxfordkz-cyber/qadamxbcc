import { test } from "node:test";
import assert from "node:assert/strict";
import { matchMarketOrder } from "../src/lib/market-order";

test("order comparison requires the intended destination even for a registered alias", () => {
  assert.equal(matchMarketOrder("sb-1042", "+7 (701) 000-00-02"), "match");
  assert.equal(matchMarketOrder("SB-2031", "+77010000002"), "close");
  assert.equal(matchMarketOrder("SB-2031", "+77010000004"), "mismatch");
  assert.equal(matchMarketOrder("unknown", "+77010000002"), "unavailable");
  assert.equal(matchMarketOrder("SB-1042", ""), "unavailable");
});

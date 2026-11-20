import assert from "node:assert/strict";
import { test } from "node:test";
import { appTabSessionKey, readAppTab, saveAppTab } from "../src/lib/app-tab-session";

test("operator navigation restores only allowlisted tabs and never stores case contents", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.equal(readAppTab(storage), "mobile");
  saveAppTab("soc", storage);
  assert.equal(readAppTab(storage), "soc");
  assert.deepEqual([...values], [[appTabSessionKey, "soc"]]);
  saveAppTab("mobile", storage);
  assert.equal(readAppTab(storage), "mobile");
  for (const invalid of ["SOC", "cases", '{"tab":"soc","token":"secret"}', "https://example.org"]) {
    storage.setItem(appTabSessionKey, invalid);
    assert.equal(readAppTab(storage), "mobile");
  }
});

test("blocked session storage never prevents navigation or fabricates restoration", () => {
  const unavailable = { getItem: () => { throw new Error("Blocked"); }, setItem: () => { throw new Error("Blocked"); } };
  assert.equal(readAppTab(unavailable), "mobile");
  assert.equal(readAppTab(), "mobile");
  assert.doesNotThrow(() => saveAppTab("soc", unavailable));
  assert.doesNotThrow(() => saveAppTab("mobile"));
});

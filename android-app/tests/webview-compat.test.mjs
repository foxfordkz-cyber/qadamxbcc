import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { copyDraftData, hasOwn, last, requestId } from "../www/compat.mjs";

test("a WebView without randomUUID generates independent RFC 4122 version 4 request IDs", () => {
  const oldWebView = { getRandomValues: array => webcrypto.getRandomValues(array) };
  const requests = new Set(Array.from({length: 128}, () => requestId(oldWebView)));
  assert.equal(requests.size, 128);
  for (const id of requests) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("draft snapshots stay independent and menu lookup excludes inherited keys", () => {
  const draft = {byOperation: {a: {amount: "25000"}}, last: null};
  const snapshot = copyDraftData(draft);
  draft.byOperation.a.amount = "900000";
  assert.equal(snapshot.byOperation.a.amount, "25000");
  assert.equal(hasOwn(snapshot, "constructor"), false);
  assert.equal(last([7, 30, 90]), 90);
  assert.equal(last([]), undefined);
});

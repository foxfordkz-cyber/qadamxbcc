import assert from "node:assert/strict";
import { createHash, getRandomValues } from "node:crypto";
import test from "node:test";
import { insecureContext, pageLock, randomId, sha256Hex, sha256HexSync } from "../src/lib/secure-fallback";
import { digestDraft } from "../src/lib/recovery";
import { withIntentLock } from "../src/components/use-recovery";

test("plain SHA-256 matches node crypto, including block boundaries and Kazakh text", async () => {
  const inputs = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(1000), "Қазақша ғ ү ұ і ң ө һ — 900 000 ₸", JSON.stringify(["00000000-0000-4000-8000-000000000001", "phone", "+77010000003", "900000.00", true, true, false])];
  for (const value of inputs) {
    const expected = createHash("sha256").update(value, "utf8").digest("hex");
    assert.equal(sha256HexSync(value), expected, value.slice(0, 20));
    assert.equal(await sha256Hex(value, undefined), expected);
    assert.equal(await sha256Hex(value), expected);
  }
  // The draft key is the same with or without WebCrypto, so receipts still match.
  assert.equal(await digestDraft("x"), sha256HexSync("x"));
});

test("UUID v4 fallback uses getRandomValues when randomUUID is withheld", () => {
  const source = { getRandomValues: <T extends ArrayBufferView | null>(array: T): T => getRandomValues(array as unknown as Uint8Array) as unknown as T };
  const id = randomId(source);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(id, randomId(source));
  assert.equal(randomId({ getRandomValues: <T extends ArrayBufferView | null>(array: T) => array, randomUUID: () => "native" }), "native");
});

test("only a non-secure page falls back to an in-page lock; elsewhere a missing lock still fails closed", async () => {
  assert.equal(insecureContext({ isSecureContext: false }), true);
  assert.equal(insecureContext({ isSecureContext: true }), false);
  assert.equal(insecureContext(undefined), false);
  let executed = false;
  await assert.rejects(withIntentLock(() => { executed = true; }, null, false), /recoveryUnavailable/);
  assert.equal(executed, false);
  assert.equal(await withIntentLock(() => 7, null, true), 7);
});

test("the in-page lock runs operations one at a time and survives a failed one", async () => {
  const order: string[] = [];
  const slow = pageLock(async () => { order.push("a:start"); await new Promise(resolve => setTimeout(resolve, 30)); order.push("a:end"); });
  const failing = pageLock(() => { order.push("b"); throw new Error("boom"); });
  const after = pageLock(() => { order.push("c"); return "ok"; });
  await slow; await assert.rejects(failing, /boom/); assert.equal(await after, "ok");
  assert.deepEqual(order, ["a:start", "a:end", "b", "c"]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { demoPresets } from "../src/lib/config";
import { acceptsEvaluation, digestDraft, draftIdentity, findDraftReceipt, mergeRecovery, persistLegacyRecovery, readRecovery, recoveryBatch, recoveryKey, saveRecovery, type RecoveryRecord } from "../src/lib/recovery";
import { evaluateDemo } from "../src/lib/demo";
import { transferSchema } from "../src/lib/contracts";
import { withIntentLock } from "../src/components/use-recovery";

const record = (state: RecoveryRecord["state"], updatedAt: number, id = crypto.randomUUID()): RecoveryRecord => ({ id, state, updatedAt });
test("two tabs merge receipts without resurrecting a terminal transfer or losing another unknown request", () => {
  const held = record("held", 20);
  const done = { ...held, state: "resolved" as const, status: "cancelled" as const, updatedAt: 30 };
  const other = record("unknown", 25);
  let value = JSON.stringify([done, other]);
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
  const merged = saveRecovery([{ ...held, updatedAt: 40 }], storage).records;
  assert.equal(merged.find(item => item.id === held.id)?.state, "resolved");
  assert.equal(merged.find(item => item.id === other.id)?.state, "unknown");
  assert.deepEqual(readRecovery(storage), merged);
});
test("history bounds never evict unresolved IDs, and malformed entries do not erase valid recovery", () => {
  const pending = Array.from({ length: 260 }, (_, index) => record("unknown", index));
  const history = Array.from({ length: 300 }, (_, index) => record("resolved", index));
  const merged = mergeRecovery(pending, history);
  assert.equal(merged.filter(item => item.state === "unknown").length, 260);
  assert.equal(merged.filter(item => item.state === "resolved").length, 250);
  const valid = pending[0];
  assert.deepEqual(readRecovery({ getItem: key => key === recoveryKey ? JSON.stringify([{ bad: "entry" }, valid]) : null }), [valid]);
});
test("duplicate-draft metadata contains a digest, excludes biometrics, and normalizes display formatting", async () => {
  const original = demoPresets.normal;
  const formatted = { ...original, amount: "25000.00", recipient: "+7 (701) 000-00-02", context: { ...original.context, pasted_recipient: true, typing_duration_ms: 999 } };
  const key = await digestDraft(draftIdentity(original, "phone"));
  assert.equal(key, await digestDraft(draftIdentity(formatted, "phone")));
  assert.equal(key, await digestDraft(draftIdentity({ ...original, context: { ...original.context, payment_requested_after_call: false } }, "phone")));
  assert.notEqual(key, await digestDraft(draftIdentity({ ...original, context: { ...original.context, payment_requested_after_call: true } }, "phone")));
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.notEqual(key, await digestDraft(draftIdentity({ ...original, amount: "25001" }, "phone")));
  const old = { ...record("resolved", 10), draftKey: key };
  const latest = { ...record("held", 20), draftKey: key };
  assert.equal(findDraftReceipt([old, latest], key)?.id, latest.id);
  let stored = "";
  saveRecovery([latest], { getItem: () => stored || null, setItem: (_name, value) => { stored = value; } });
  for (const sensitive of [original.recipient, original.sender, '"amount"', '"context"', '"pasted_recipient"']) assert.equal(stored.includes(sensitive), false);
});
test("missing Web Locks and unreadable or unwritable storage fail before admitting an intent", async () => {
  let executed = false;
  await assert.rejects(withIntentLock(() => { executed = true; }, null), /recoveryUnavailable/);
  assert.equal(executed, false);
  assert.equal(saveRecovery([record("unknown", 1)], { getItem: () => null, setItem: () => { throw new Error("quota"); } }).persisted, false);
  assert.equal(saveRecovery([record("unknown", 1)], { getItem: () => { throw new Error("disabled"); }, setItem: () => { executed = true; } }).persisted, false);
  assert.equal(executed, false);
});
test("legacy pending IDs survive failed migration until durable local storage acknowledges the write", () => {
  const pending = record("unknown", 1);
  let removed = false; let stored: string | null = null;
  const legacy = { removeItem: () => { removed = true; } };
  const failed = persistLegacyRecovery([pending], { getItem: () => null, setItem: () => { throw new Error("quota"); } }, legacy);
  assert.equal(failed.persisted, false); assert.equal(removed, false);
  const saved = persistLegacyRecovery([pending], { getItem: () => stored, setItem: (_key, value) => { stored = value; } }, legacy);
  assert.equal(saved.persisted, true); assert.equal(removed, true); assert.ok(String(stored).includes(pending.id));
});
test("automatic recovery rotates over 250 pending IDs with at most four reads and current receipt priority", () => {
  const records = Array.from({ length: 250 }, (_, index) => record("held", index));
  const currentId = records[0].id;
  const visited = new Set<string>(); let cursor = 0;
  for (let round = 0; round < 90; round++) {
    const batch = recoveryBatch(records, cursor, currentId);
    assert.ok(batch.records.length <= 4); assert.equal(batch.records[0].id, currentId);
    batch.records.forEach(item => visited.add(item.id)); cursor = batch.nextCursor;
  }
  assert.equal(visited.size, 250);
});
test("a delayed hold response cannot resurrect a cancelled receipt or overwrite newer questionnaire data", () => {
  const form = demoPresets.scam;
  const held = evaluateDemo(transferSchema.parse({ sender_id: form.sender, recipient_phone: form.recipient, amount: form.amount, context: form.context }));
  const cancelled = { ...held, status: "cancelled" as const, server_time: new Date(Date.parse(held.server_time!) + 1000).toISOString() };
  const stored = { ...record("resolved", 2, held.transaction_id), status: "cancelled" as const };
  assert.equal(acceptsEvaluation(held, stored, cancelled), false);
  assert.equal(acceptsEvaluation(held, undefined, { ...held, server_time: cancelled.server_time }), false);
  assert.equal(acceptsEvaluation(cancelled, stored, held), true);
});

test("a concurrent old transaction snapshot cannot erase saved answers despite a later response timestamp", () => {
  const form = demoPresets.scam;
  const held = evaluateDemo(transferSchema.parse({ sender_id: form.sender, recipient_phone: form.recipient, amount: form.amount, context: form.context }));
  const start = Date.parse(held.server_time!);
  const at = (offset: number) => new Date(start + offset).toISOString();
  const saved = { ...held, updated_at: at(1000), server_time: at(1100), verification_answers: {
    caller_claims_bank_or_police: false, asked_to_move_to_safe_account: false, asked_to_keep_secret_or_install_app: false,
    initiated_by_customer: true, knows_recipient_personally: true,
  } };
  // The GET loaded its row before POST committed, then finished relationship reads later.
  const delayedRead = { ...held, updated_at: at(0), server_time: at(1200), verification_answers: null };
  assert.equal(acceptsEvaluation(delayedRead, undefined, saved), false);
  assert.equal(acceptsEvaluation(saved, undefined, delayedRead), true);
  assert.equal(acceptsEvaluation({ ...saved, server_time: at(1300) }, undefined, saved), true);
});

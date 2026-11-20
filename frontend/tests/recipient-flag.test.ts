import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, feedQuerySchema, validateApiResponse } from "../src/lib/contracts";
import { DemoError, evaluateDemo, feedDemo, graphDemo, recipientFlagDemo, resolveDemo, setRecipientFlagDemo } from "../src/lib/demo";
import { ids } from "../src/lib/demo-ids";
import { flagMarker, readFlagMarker, recipientFlagInputSchema } from "../src/lib/recipient-flag";
import { socFeedPath } from "../src/lib/soc-feed";
import { staticApi } from "../src/lib/static-api";

const input = (flagged: boolean, expected_version: number) => ({ flagged, expected_version, note: "Synthetic SOC review", request_id: crypto.randomUUID() });
const transfer = (sender_id = ids.sender) => ({ sender_id, recipient_id: ids.friend, amount: "1000", currency: "KZT" as const, context: { active_call: false, from_deposit: false, is_new_device: false, is_new_recipient: false } });

test("reviewed flag blocks a new transfer from another sender, survives replay, and unflag leaves old decisions intact", () => {
  const before = evaluateDemo(transfer());
  const request = input(true, recipientFlagDemo(ids.friend).version);
  const receipt = setRecipientFlagDemo(ids.friend, request);
  assert.equal(graphDemo(ids.friend).nodes[0].data.flagged, true);
  const blocked = evaluateDemo(transfer(ids.stranger));
  assert.equal(blocked.status, "blocked"); assert.ok(blocked.risk_score >= 75);
  assert.ok(blocked.reasons.some(reason => reason.code === "RECIPIENT_FLAGGED"));
  assert.equal(blocked.reasons.reduce((sum, reason) => sum + reason.score_delta, 0), blocked.risk_score);
  assert.equal(blocked.reasons.find(reason => reason.code === "RECIPIENT_FLAGGED")?.evidence?.confirmed_flag_minimum, 75);
  assert.deepEqual(setRecipientFlagDemo(ids.friend, request), receipt);
  assert.equal(recipientFlagDemo(ids.friend).version, receipt.version);
  assert.throws(() => setRecipientFlagDemo(ids.friend, { ...request, note: "Changed payload" }), (e: unknown) => e instanceof DemoError && e.message === "flag_idempotency_conflict");
  assert.throws(() => setRecipientFlagDemo(ids.friend, input(false, 0)), (e: unknown) => e instanceof DemoError && e.message === "flag_version_conflict");
  setRecipientFlagDemo(ids.friend, input(false, receipt.version));
  assert.equal(graphDemo(ids.friend).nodes[0].data.flagged, false);
  const allowed = evaluateDemo(transfer(ids.stranger));
  assert.equal(allowed.status, "approved"); assert.ok(!allowed.reasons.some(reason => reason.code === "RECIPIENT_FLAGGED"));
  assert.equal(before.status, "approved"); assert.equal(blocked.status, "blocked");
});

test("alerts filter excludes approved/cancelled before pagination while retaining global KPIs", () => {
  const all = feedDemo({ limit: 200 }); const alerts = feedDemo({ alerts_only: true, limit: 1 });
  assert.equal(alerts.pagination.total_filtered, all.items.filter(row => ["cooling_off", "blocked"].includes(row.status)).length);
  assert.equal(alerts.items.length, Math.min(1, alerts.pagination.total_filtered));
  assert.equal(alerts.stats.total, all.stats.total);
  assert.ok(alerts.items.every(row => ["cooling_off", "blocked"].includes(row.status)));
  assert.equal(new URLSearchParams(socFeedPath("all", "", 25, true).split("?")[1]).get("alerts_only"), "true");
  assert.equal(feedQuerySchema.parse({ alerts_only: "false" }).alerts_only, false);
  assert.equal(feedQuerySchema.safeParse({ alerts_only: "yes" }).success, false);
});

test("a held transfer rechecks the current flag before release and later unflag never releases that block", () => {
  const held = evaluateDemo({ ...transfer(), amount: "900000", context: { active_call: true, from_deposit: true, is_new_device: false, is_new_recipient: false } });
  assert.equal(held.status, "cooling_off");
  const flagged = setRecipientFlagDemo(ids.friend, input(true, recipientFlagDemo(ids.friend).version));
  const clean = { caller_claims_bank_or_police: false, asked_to_move_to_safe_account: false, asked_to_keep_secret_or_install_app: false, initiated_by_customer: true, knows_recipient_personally: true };
  const blocked = resolveDemo(held.transaction_id, clean, Date.parse(held.cooling_off_until!) + 1);
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.reasons.some(reason => reason.code === "RECIPIENT_FLAGGED_AT_RELEASE"));
  setRecipientFlagDemo(ids.friend, input(false, flagged.version));
  assert.equal(resolveDemo(held.transaction_id, clean).status, "blocked");
});

test("flag contracts require bounded note, request identity, version and matching response account", () => {
  assert.equal(recipientFlagInputSchema.safeParse(input(true, 0)).success, true);
  for (const patch of [{ note: " " }, { note: "x".repeat(201) }, { note: "line\nbreak" }, { note: "hidden\u0000content" }, { expected_version: -1 }, { request_id: "missing" }, { role: "admin" }]) assert.equal(recipientFlagInputSchema.safeParse({ ...input(true, 0), ...patch }).success, false);
  assert.throws(() => validateApiResponse(`soc/recipients/${ids.sender}/flag`, recipientFlagDemo(ids.friend)), (e: unknown) => e instanceof ApiError && e.code === "invalidResponse");
  const marker = flagMarker(ids.friend, input(true, 0));
  assert.ok(!marker.includes("Synthetic")); assert.ok(!marker.includes("note"));
  assert.equal(readFlagMarker(ids.sender, marker), null); assert.ok(readFlagMarker(ids.friend, marker));
});

test("static Pages persists flag/audit receipts across in-memory reload and applies the same rule", async t => {
  const saved = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); });
  const route = `soc/recipients/${ids.friend}/flag`;
  const request = input(true, recipientFlagDemo(ids.friend).version);
  const flagged = await staticApi(route, { method: "POST", body: JSON.stringify(request) });
  const root = globalThis as typeof globalThis & { bccDemoRecipientFlags?: Map<string, unknown>; bccDemoFlagReceipts?: Map<string, unknown> };
  delete root.bccDemoRecipientFlags; delete root.bccDemoFlagReceipts;
  const recovered = await staticApi(route) as { flagged: boolean; version: number };
  assert.equal(recovered.flagged, true);
  assert.deepEqual(await staticApi(route, { method: "POST", body: JSON.stringify(request) }), flagged);
  const blocked = await staticApi("transfers/evaluate", { method: "POST", body: JSON.stringify(transfer(ids.stranger)) }) as { status: string };
  assert.equal(blocked.status, "blocked");
  await staticApi(route, { method: "POST", body: JSON.stringify(input(false, recovered.version)) });
  const unflagged = await staticApi("transfers/evaluate", { method: "POST", body: JSON.stringify(transfer(ids.stranger)) }) as { status: string };
  assert.equal(unflagged.status, "approved");
});

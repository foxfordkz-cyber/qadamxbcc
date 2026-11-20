import assert from "node:assert/strict";
import { test } from "node:test";
import { demoPresets, demoTrafficAccounts, ids } from "../src/lib/config";
import { BiometricSensor, warningKeys } from "../src/lib/biometrics";
import { preventedLoss, reconcileTraffic, trafficScenario, type TrafficRecord } from "../src/lib/traffic";
import { ApiError, transferSchema, validateApiResponse, type Answers, type Preset } from "../src/lib/contracts";
import { abandonDemo, cancelDemo, DemoError, detailDemo, evaluateDemo, feedDemo, graphDemo, resolveDemo } from "../src/lib/demo";
import { readPending, remainingSeconds, TransferAttempt, writePending } from "../src/lib/transfer-session";
import { countBlockedHubs } from "../src/lib/feed-summary";
import { money } from "../src/lib/i18n";

function run(key: Preset) {
  const p = demoPresets[key];
  return evaluateDemo(transferSchema.parse({ sender_id: p.sender, recipient_phone: p.recipient, amount: p.amount, context: p.context }));
}
const clean: Answers = { caller_claims_bank_or_police: false, asked_to_move_to_safe_account: false, asked_to_keep_secret_or_install_app: false, initiated_by_customer: true, knows_recipient_personally: true };
test("presets remain deterministic on repeated use and retain both translations", () => {
  for (let i = 0; i < 3; i++) for (const [key, status] of [["normal", "approved"], ["scam", "cooling_off"], ["hub", "blocked"]] as const) {
    const result = run(key);
    assert.equal(result.status, status);
    assert.equal(result.reasons_kk.length, result.reasons_ru.length);
    assert.ok(result.latency_ms >= 0);
    if (status === "cooling_off") assert.ok(Date.parse(result.cooling_off_until!) - Date.now() > 899000);
  }
});
test("questionnaire blocks red flags immediately, holds clean answers until expiry, and replays identical decisions", () => {
  const risky = run("scam");
  const riskyAnswers = { ...clean, asked_to_move_to_safe_account: true };
  assert.equal(resolveDemo(risky.transaction_id, riskyAnswers).status, "blocked");
  assert.equal(resolveDemo(risky.transaction_id, riskyAnswers).status, "blocked");
  assert.throws(() => resolveDemo(risky.transaction_id, clean), (e: unknown) => e instanceof DemoError && e.status === 409);
  const safe = run("scam");
  assert.equal(resolveDemo(safe.transaction_id, clean).status, "cooling_off");
  assert.deepEqual(detailDemo(safe.transaction_id).verification_answers, clean);
  assert.equal(resolveDemo(safe.transaction_id, clean, Date.parse(safe.cooling_off_until!) - 1).status, "cooling_off");
  assert.equal(detailDemo(safe.transaction_id, Date.parse(safe.cooling_off_until!) + 1).status, "cooling_off", "timer expiry alone never releases money");
  assert.equal(resolveDemo(safe.transaction_id, clean, Date.parse(safe.cooling_off_until!)).status, "approved");
  assert.equal(feedDemo().items.find(r => r.transaction_id === safe.transaction_id)?.status, "approved");
});
test("cancel is durable and idempotent, and cannot release a cancelled hold", () => {
  const held = run("scam");
  assert.equal(cancelDemo(held.transaction_id).status, "cancelled");
  assert.equal(cancelDemo(held.transaction_id).status, "cancelled");
  assert.equal(detailDemo(held.transaction_id).cooling_off_until, null);
  assert.equal(feedDemo().items.find(row => row.transaction_id === held.transaction_id)?.status, "cancelled");
  assert.throws(() => resolveDemo(held.transaction_id, clean), (error: unknown) => error instanceof DemoError && error.status === 409);
});
test("unknown recipient only blocks verification when combined with pressure signals", () => {
  const underPressure = run("scam");
  const unknownRecipient = { ...clean, knows_recipient_personally: false };
  assert.equal(resolveDemo(underPressure.transaction_id, unknownRecipient).status, "blocked");
  const ordinary = evaluateDemo(transferSchema.parse({ sender_id: ids.sender, recipient_phone: demoPresets.scam.recipient, amount: "500000", context: { is_new_device: true, is_new_recipient: true } }));
  assert.equal(ordinary.status, "cooling_off");
  assert.equal(resolveDemo(ordinary.transaction_id, unknownRecipient, Date.parse(ordinary.cooling_off_until!)).status, "approved");
});
test("request UUID replays exactly once, detects changed payloads, and detail reveals current lifecycle", () => {
  const form = demoPresets.scam;
  const input = transferSchema.parse({ request_id: crypto.randomUUID(), sender_id: form.sender, recipient_phone: form.recipient, amount: form.amount, context: form.context });
  const original = evaluateDemo(input);
  assert.equal(original.transaction_id, input.request_id);
  cancelDemo(original.transaction_id);
  assert.deepEqual(evaluateDemo(input), original);
  assert.equal(detailDemo(original.transaction_id).status, "cancelled");
  assert.equal(feedDemo().items.filter(row => row.transaction_id === original.transaction_id).length, 1);
  assert.throws(() => evaluateDemo({ ...input, amount: "100" }), (error: unknown) => error instanceof DemoError && error.status === 409);
});
test("abandonment tombstones late requests and never undoes an already processed transfer", () => {
  const id = crypto.randomUUID();
  assert.equal(abandonDemo(id).status, "abandoned");
  assert.equal(abandonDemo(id, Date.now(), 0).status, "abandoned");
  const input = transferSchema.parse({ request_id: id, sender_id: ids.sender, recipient_phone: demoPresets.normal.recipient, amount: "100", context: {} });
  assert.throws(() => evaluateDemo(input), (error: unknown) => error instanceof DemoError && error.status === 409);
  const approved = run("normal");
  const receipt = abandonDemo(approved.transaction_id);
  assert.equal(receipt.status, "processed"); assert.equal(receipt.evaluation?.status, "approved");
});
test("demo capacity rejects only new intents while preserving replay and existing holds", () => {
  const input = transferSchema.parse({ request_id: crypto.randomUUID(), sender_id: ids.sender, recipient_phone: demoPresets.scam.recipient, amount: "900000", context: demoPresets.scam.context });
  const evaluated = evaluateDemo(input);
  const count = feedDemo().stats.total;
  assert.deepEqual(evaluateDemo(input, Date.now(), 0), evaluated);
  assert.throws(() => evaluateDemo({ ...input, request_id: crypto.randomUUID() }, Date.now(), 0), (error: unknown) => error instanceof DemoError && error.message === "demoCapacity");
  assert.throws(() => abandonDemo(crypto.randomUUID(), Date.now(), 0), (error: unknown) => error instanceof DemoError && error.message === "demoCapacity");
  assert.equal(feedDemo().stats.total, count);
  assert.equal(resolveDemo(evaluated.transaction_id, clean).status, "cooling_off");
  assert.equal(cancelDemo(evaluated.transaction_id).status, "cancelled");
});
test("malformed successful API responses fail safely, and nullable legacy ML stays supported", () => {
  assert.throws(() => validateApiResponse("transfers/evaluate", {}), (error: unknown) => error instanceof ApiError && error.code === "invalidResponse");
  const result = run("normal");
  assert.doesNotThrow(() => validateApiResponse(`transfers/${result.transaction_id}`, { ...result, ml_score: null, ml_model_version: null, ml_contributors: [] }));
  assert.throws(() => validateApiResponse(`transfers/requests/${result.transaction_id}/abandon`, { request_id: result.transaction_id, status: "processed", server_time: new Date().toISOString() }), ApiError);
});
test("real backend nullable call-check context does not hide a saved transfer or the SOC feed", () => {
  const result = run("scam");
  const context = { ...result.context, bank_call_check_id: null };
  assert.doesNotThrow(() => validateApiResponse(`transfers/${result.transaction_id}`, { ...result, context }));
  const feed = feedDemo({ q: result.transaction_id });
  assert.doesNotThrow(() => validateApiResponse("soc/feed", { ...feed, items: feed.items.map(item => ({ ...item, context: { ...item.context, bank_call_check_id: null } })) }));
  assert.throws(() => validateApiResponse(`transfers/${result.transaction_id}`, { ...result, context: { ...context, bank_call_check_id: "invalid" } }), ApiError);
  assert.equal(transferSchema.safeParse({ sender_id: ids.sender, recipient_phone: "+77010000003", amount: "1", context: { bank_call_check_id: null } }).success, false);
});
test("hub graph has 12 incoming senders and a shared-device edge", () => {
  const graph = graphDemo(ids.hub);
  assert.equal(graph.edges.filter(e => e.target === ids.hub).length, 12);
  assert.ok(graph.edges.some(e => e.data.edge_type === "shared_device"));
  assert.ok(graph.nodes.find(n => n.id === ids.hub)?.data.suspected_mule);
});
test("invalid amounts and ambiguous recipients are rejected", () => {
  const input = { sender_id: ids.sender, recipient_phone: "+77010000002", amount: "0", context: {} };
  assert.equal(transferSchema.safeParse(input).success, false);
  assert.equal(transferSchema.safeParse({ ...input, amount: "1.001" }).success, false);
  assert.equal(transferSchema.safeParse({ ...input, amount: "10", recipient_id: ids.friend }).success, false);
});

test("SOC hub KPI excludes scam blocks and deduplicates blocked hub recipients", () => {
  const result = run("hub");
  const hub = feedDemo({ q: result.transaction_id }).items[0];
  const scam = { ...hub, recipient: { ...hub.recipient, id: ids.stranger }, reasons: [{ code: "QUESTIONNAIRE", layer: "questionnaire", score_delta: 90, reason_kk: "", reason_ru: "" }] };
  assert.equal(countBlockedHubs([scam]), 0);
  assert.equal(countBlockedHubs([hub, { ...hub, transaction_id: "repeat" }, scam]), 1);
  assert.equal(countBlockedHubs([{ ...hub, status: "cooling_off" }]), 0);
});

test("KZT formatting is deterministic in kk and ru, including fractional tenge", () => {
  for (const lang of ["kk", "ru"] as const) {
    assert.equal(money(25000, lang), "25\u00a0000 ₸");
    assert.equal(money("1234567.50", lang), "1\u00a0234\u00a0567,5 ₸");
    assert.equal(money("invalid", lang), "— ₸");
  }
});

test("real event timing detects pauses/deletions and excludes time away from an input", () => {
  const sensor = new BiometricSensor();
  sensor.focus("recipient", 0);
  sensor.input("recipient", 1, "insertText", 1, 100);
  sensor.input("recipient", 2, "insertText", 1, 600);
  sensor.input("recipient", 1, "deleteContentBackward", 0, 2600);
  assert.equal(sensor.snapshot().hesitation_count, 2);
  assert.equal(sensor.context().typing_duration_ms, 2500);
  assert.equal(sensor.context().recipient_input_length, 2);
  sensor.blur("recipient");
  sensor.focus("recipient", 1);
  sensor.input("recipient", 2, "insertText", 1, 20000);
  assert.equal(sensor.context().typing_duration_ms, 2500);
  sensor.focus("amount", 4);
  sensor.input("amount", 3, "deleteContentBackward", 0, 21000);
  assert.equal(sensor.context().hesitation_count, 3);
  sensor.input("amount", 4, "insertText", 1, 21500);
  assert.equal(sensor.snapshot().typing_duration_ms, 3000);
  assert.equal(sensor.context().typing_duration_ms, 2500, "amount edits must not dilute recipient cadence");
  assert.equal(sensor.context().recipient_input_length, 3);
});

test("recipient paste is sticky until reset; amount paste never flags the recipient", () => {
  const sensor = new BiometricSensor();
  sensor.paste("amount");
  assert.equal(sensor.context().pasted_recipient, false);
  sensor.paste("recipient");
  sensor.input("recipient", 12, "insertFromPaste", 12, 100);
  assert.equal(sensor.context().pasted_recipient, true);
  assert.equal(sensor.context().recipient_input_length, 0);
  assert.equal(sensor.context().typing_duration_ms, 0);
  sensor.reset();
  assert.deepEqual(sensor.context(), { pasted_recipient: false, typing_duration_ms: null, recipient_input_length: null, hesitation_count: 0, hesitation_ms: null });
});
test("clearing a pasted recipient removes that recipient's paste signal", () => {
  const sensor = new BiometricSensor();
  sensor.paste("recipient"); sensor.input("recipient", 12, "insertFromPaste", 12, 100);
  sensor.input("recipient", 0, "deleteContentBackward", 0, 200);
  sensor.input("recipient", 1, "insertText", 1, 300);
  assert.equal(sensor.context().pasted_recipient, false);
  assert.equal(sensor.context().recipient_input_length, 1);
});
test("waiting after clearing a recipient is not counted as the new recipient's typing time", () => {
  const sensor = new BiometricSensor();
  sensor.input("recipient", 12, "insertFromPaste", 12, 100);
  sensor.input("recipient", 0, "deleteContentBackward", 0, 200);
  sensor.input("recipient", 1, "insertText", 1, 60000);
  sensor.input("recipient", 2, "insertText", 1, 60500);
  assert.equal(sensor.context().typing_duration_ms, 500);
});
test("select-all replacement starts fresh recipient cadence without retaining a paste flag", () => {
  const sensor = new BiometricSensor();
  sensor.paste("recipient"); sensor.input("recipient", 12, "insertFromPaste", 12, 100);
  sensor.input("recipient", 1, "insertText", 1, 4000);
  sensor.input("recipient", 2, "insertText", 1, 4500);
  assert.equal(sensor.context().pasted_recipient, false);
  assert.equal(sensor.context().recipient_input_length, 2);
  assert.equal(sensor.context().typing_duration_ms, 500);
});
test("recovery storage contains only bounded UUIDs and countdown ignores local wall-clock skew", () => {
  let stored = "";
  const storage = { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } };
  const id = crypto.randomUUID();
  writePending([id, id], storage);
  assert.deepEqual(readPending(storage), [id]);
  assert.equal(stored.includes("amount"), false);
  stored = '["invalid"]'; assert.deepEqual(readPending(storage), []);
  assert.deepEqual(readPending({ getItem: () => { throw new Error("disabled"); } }), []);
  const result = { server_time: "2026-01-01T00:00:00Z", cooling_off_until: "2026-01-01T00:15:00Z" };
  assert.equal(remainingSeconds(result, 3000, Date.parse("2030-01-01T00:00:00Z")), 897);
  assert.equal(remainingSeconds(result, 900000, 0), 0);
});
test("ambiguous evaluation retry uses the original UUID and returns the authoritative current decision", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: string[] = [];
  const input = transferSchema.parse({ sender_id: ids.sender, recipient_phone: demoPresets.scam.recipient, amount: "900000", context: demoPresets.scam.context });
  const attempt = new TransferAttempt(input);
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("evaluate")) {
      bodies.push(String(init?.body));
      const result = evaluateDemo(JSON.parse(String(init?.body)) as typeof input);
      if (bodies.length === 1) { cancelDemo(result.transaction_id); throw new TypeError("lost response"); }
      return Response.json(result);
    }
    return Response.json(detailDemo(attempt.input.request_id!));
  };
  try { await assert.rejects(attempt.execute()); assert.equal((await attempt.execute()).status, "cancelled"); assert.equal(bodies[0], bodies[1]); }
  finally { globalThis.fetch = originalFetch; }
});

test("biometrics survive request validation with backend-compatible bounds", () => {
  const base = { sender_id: ids.sender, recipient_phone: demoPresets.normal.recipient, amount: "1000" };
  const context = { pasted_recipient: true, typing_duration_ms: 12000, hesitation_count: 3, recipient_input_length: 12, hesitation_ms: 8000 };
  const parsed = transferSchema.parse({ ...base, context });
  for (const [key, value] of Object.entries(context)) assert.equal(parsed.context[key as keyof typeof context], value);
  assert.equal(transferSchema.safeParse({ ...base, context: { hesitation_count: -1 } }).success, false);
  assert.equal(transferSchema.safeParse({ ...base, context: { typing_duration_ms: 1.5 } }).success, false);
  assert.equal(transferSchema.safeParse({ ...base, context: { hesitation_count: 101 } }).success, false);
  const result = evaluateDemo({ ...parsed, context: { ...parsed.context, active_call: true } });
  assert.ok(result.reasons.some(reason => reason.code === "PASTED_DURING_CALL"));
  assert.equal(result.ml_score, undefined, "rule-only demo must not invent ML probabilities");
});

test("cooling warnings use exact submitted context or server reason codes", () => {
  assert.deepEqual(warningKeys({ active_call: true, from_deposit: true, pasted_recipient: true }, []), ["warningSafeAccount", "warningPaste"]);
  assert.deepEqual(warningKeys({}, [{ code: "PASTED_DURING_CALL", layer: "behavioral", score_delta: 15, reason_kk: "", reason_ru: "" }]), ["warningPaste"]);
  assert.deepEqual(warningKeys({ is_new_device: true }, []), ["warningDevice"]);
  assert.deepEqual(warningKeys({}, []), ["warningGeneric"]);
});

test("traffic uses configured accounts, covers four cities and yields diverse decisions", () => {
  const cities = new Set<string>();
  const statuses = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const scenario = trafficScenario(demoTrafficAccounts, i)!;
    assert.notEqual(scenario.input.sender_id, scenario.input.recipient_id);
    assert.ok(demoTrafficAccounts.some(account => account.id === scenario.input.sender_id));
    cities.add(scenario.from); cities.add(scenario.to);
    statuses.add(evaluateDemo(scenario.input).status);
  }
  assert.deepEqual([...cities].sort(), ["almaty", "astana", "atyrau", "shymkent"]);
  assert.deepEqual([...statuses].sort(), ["approved", "blocked", "cooling_off"]);
  assert.equal(trafficScenario([], 0), null);
  const configured = trafficScenario([], 2, demoPresets)!;
  assert.equal(configured.input.sender_id, demoPresets.normal.sender);
  assert.equal(configured.input.recipient_phone, demoPresets.scam.recipient);
  assert.equal(configured.to, "shymkent");
});

test("prevented loss counts unique blocked transfers only and retains reconciled decisions", () => {
  const held = run("scam");
  const blocked = run("hub");
  const records: Record<string, TrafficRecord> = {
    [held.transaction_id]: { evaluation: held, amount: "100.50", from: "astana", to: "shymkent" },
    [blocked.transaction_id]: { evaluation: blocked, amount: "250000", from: "almaty", to: "atyrau" },
  };
  assert.equal(preventedLoss(records, []), 250000);
  const row = feedDemo().items.find(item => item.transaction_id === held.transaction_id)!;
  const update = { ...row, status: "blocked" as const };
  assert.equal(preventedLoss(records, [update, update]), 250100.50);
  const reconciled = reconcileTraffic(records, [update]);
  assert.equal(preventedLoss(reconciled, []), 250100.50);
  assert.equal(reconcileTraffic(reconciled, [update]), reconciled);
});

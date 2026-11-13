import assert from "node:assert/strict";
import { test } from "node:test";
import { completeAnswers, remainingSeconds } from "../src/lib/cooling";
import { demoPresets, demoTrafficAccounts, ids } from "../src/lib/config";

test("cooling countdown uses the API deadline across reopening and tab suspension", () => {
  const start = Date.parse("2026-11-13T10:00:00Z");
  const deadline = "2026-11-13T10:15:00Z";
  assert.equal(remainingSeconds(deadline, start), 900);
  assert.equal(remainingSeconds(deadline, start + 89_500), 811);
  assert.equal(remainingSeconds(deadline, start + 901_000), 0);
  assert.equal(remainingSeconds(null, start), null);
  assert.equal(remainingSeconds("invalid", start), null);
});

test("verification requires five explicit answers, including false responses", () => {
  assert.equal(completeAnswers({}), false);
  assert.equal(completeAnswers({ caller_claims_bank_or_police: false }), false);
  assert.equal(completeAnswers({
    caller_claims_bank_or_police: false, asked_to_move_to_safe_account: false,
    asked_to_keep_secret_or_install_app: false, initiated_by_customer: false,
    knows_recipient_personally: false,
  }), true);
});
import { BiometricSensor, warningKeys } from "../src/lib/biometrics";
import { preventedLoss, reconcileTraffic, trafficScenario, type TrafficRecord } from "../src/lib/traffic";
import { transferSchema, type Answers, type Preset } from "../src/lib/contracts";
import { DemoError, evaluateDemo, feedDemo, graphDemo, resolveDemo } from "../src/lib/demo";
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
test("questionnaire blocks red flags, releases clean answers, rejects repeated resolution", () => {
  const risky = run("scam");
  assert.equal(resolveDemo(risky.transaction_id, { ...clean, asked_to_move_to_safe_account: true }).status, "blocked");
  assert.throws(() => resolveDemo(risky.transaction_id, clean), (e: unknown) => e instanceof DemoError && e.status === 409);
  const safe = run("scam");
  assert.equal(resolveDemo(safe.transaction_id, clean).status, "approved");
  assert.equal(feedDemo().items.find(r => r.transaction_id === safe.transaction_id)?.status, "approved");
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
  run("hub");
  const hub = feedDemo().items[0];
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
  assert.equal(sensor.context().typing_duration_ms, 3000);
  assert.equal(sensor.context().recipient_input_length, null);
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

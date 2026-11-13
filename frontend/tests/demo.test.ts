import assert from "node:assert/strict";
import { test } from "node:test";
import { demoPresets, ids } from "../src/lib/config";
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

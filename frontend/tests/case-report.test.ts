import assert from "node:assert/strict";
import { test } from "node:test";
import type { Evaluation } from "../src/lib/contracts";
import { caseReport, caseTimestamps } from "../src/lib/case-report";

const created = "2026-11-17T12:00:00Z";
const updated = "2026-11-17T12:02:00Z";
function record(): Evaluation {
  return {
    transaction_id: "00000000-0000-4000-8000-000000000123", status: "cooling_off", risk_score: 74,
    headline_kk: "Кідіріс", headline_ru: "Удержание", reasons_kk: ["Қоңырау"], reasons_ru: ["Звонок"],
    reasons: [{ code: "ACTIVE_CALL", layer: "behavioral", score_delta: 25, reason_kk: "Қоңырау", reason_ru: "Звонок" }],
    latency_ms: 3.5, layer_latency_ms: { behavioral: 0.2, graph: 0.3, ml: 0.1 },
    cooling_off_until: "2026-11-17T12:15:00Z", created_at: created, updated_at: updated,
    is_new_recipient: true, is_new_device: false, amount: "900000.01",
    recipient: { id: "00000000-0000-4000-8000-000000000003", display_name: "PRIVATE_NAME_CANARY", iban_masked: "PRIVATE_IBAN_CANARY" },
    context: { active_call: true, from_deposit: true, pasted_recipient: true },
    ml_score: 92, ml_model_version: "model-v2", ml_explanation_method: "tree_path_probability",
    ml_contributors: [{ feature: "active_call", value: 1, contribution: 30, label_kk: "Қоңырау", label_ru: "Звонок" }],
  };
}

test("case report exports a bilingual allowlist without identities, raw evidence or clipboard", () => {
  const detail = record();
  Object.assign(detail, { sender: { full_name: "PRIVATE_SENDER_CANARY" }, raw_input: "PRIVATE_RAW_CANARY" });
  Object.assign(detail.context!, { clipboard: "PRIVATE_CLIPBOARD_CANARY", device_id: "PRIVATE_DEVICE_CANARY" });
  Object.assign(detail.reasons[0], { evidence: { clipboard: "PRIVATE_EVIDENCE_CANARY" } });
  Object.assign(detail.ml_contributors![0], { customer_name: "PRIVATE_ML_CANARY" });
  detail.layer_latency_ms.PRIVATE_TIMING_CANARY = 1;
  const report = caseReport(detail, "kk", created);
  const json = JSON.stringify(report);
  assert.ok(!json.includes("PRIVATE_"));
  assert.equal(report.transaction.amount, "900000.01");
  assert.equal(report.transaction.id, detail.transaction_id);
  assert.equal(report.transaction.status, "cooling_off");
  assert.equal(report.reasons[0].reason_ru, "Звонок");
  assert.equal(report.reasons[0].reason_kk, "Қоңырау");
  assert.equal(report.context_signals.pasted_recipient, true);
  assert.equal(report.ml.score, 92);
  assert.equal(report.exported_at, created);
});

test("timeline does not turn a deadline or saved questionnaire into an invented release event", () => {
  const detail = record();
  const held = caseTimestamps(detail);
  assert.deepEqual(held.map(item => item.key), ["caseCreated", "caseUpdated", "caseHoldDeadline"]);
  assert.equal(held[2].future, true);
  const cancelled = caseTimestamps({ ...detail, status: "cancelled", resolved_at: updated });
  assert.deepEqual(cancelled.map(item => item.key), ["caseCreated", "caseResolved"]);
  assert.equal(cancelled[1].time, updated);
  assert.ok(!cancelled.some(item => item.future));
  assert.deepEqual(caseTimestamps({ ...detail, created_at: undefined, updated_at: undefined, cooling_off_until: null }), []);
});

test("legacy records preserve unknown model/timestamps and finite timing allowlist", () => {
  const detail = { ...record(), ml_score: null, ml_model_version: undefined, ml_contributors: undefined, created_at: undefined, updated_at: undefined };
  detail.layer_latency_ms = { graph: Infinity, ml: -1, velocity: 1.4 };
  const report = caseReport(detail, "ru");
  assert.equal(report.ml.score, null); assert.equal(report.ml.model_version, null);
  assert.deepEqual(report.ml.contributors, []); assert.equal(report.transaction.created_at, null);
  assert.deepEqual(report.latency.layers_ms, { velocity: 1.4 });
});

import assert from "node:assert/strict";
import test from "node:test";
import { caseTimeline } from "../src/lib/case-timeline";
import { policeReportHtml } from "../src/lib/police-report";
import type { Evaluation } from "../src/lib/contracts";

const created = "2026-11-20T10:00:00.000Z";
const base = {
  transaction_id: "11111111-1111-4111-8111-111111111111", status: "cooling_off", risk_score: 74,
  headline_kk: "", headline_ru: "", reasons_kk: [], reasons_ru: [], latency_ms: 20, layer_latency_ms: {},
  recipient: { id: "22222222-2222-4222-8222-222222222222", display_name: "Алексей К.", iban_masked: "KZ** •••• 0003" },
  amount: "900000", created_at: created, updated_at: created, cooling_off_until: "2026-11-20T10:15:00.000Z",
  context: { active_call: true, from_deposit: true, is_new_device: false, pasted_recipient: true },
  reasons: [
    { code: "ACTIVE_CALL", layer: "behavioral", score_delta: 25, reason_kk: "Қоңырау", reason_ru: "Идёт звонок" },
    { code: "BANK_CALL_DENIED", layer: "behavioral", score_delta: 20, reason_kk: "Банк қоңырау шалмаған", reason_ru: "Банк не звонил <script>" },
  ],
} as unknown as Evaluation;

test("a held transfer tells its story up to the planned end of the pause", () => {
  const keys = caseTimeline(base).map(event => event.key);
  assert.deepEqual(keys, ["tlSent", "tlSignals", "tlBankLog", "tlDecisionHeld", "tlHoldUntil"]);
  assert.deepEqual(caseTimeline(base)[1].signals, ["active_call", "from_deposit", "pasted_recipient"]);
});

test("answers and the outcome follow the hold", () => {
  const resolved = "2026-11-20T10:05:00.000Z";
  const stopped = caseTimeline({ ...base, status: "blocked", resolved_at: resolved, risk_score: 100, reasons: [...base.reasons, { code: "QUESTIONNAIRE_RED_FLAG", layer: "behavioral", score_delta: 40, reason_kk: "", reason_ru: "" }] } as Evaluation);
  assert.deepEqual(stopped.slice(-3).map(event => event.key), ["tlDecisionHeld", "tlAnswersFlag", "tlStopped"]);
  assert.equal(stopped.at(-1)?.time, resolved);
  const released = caseTimeline({ ...base, status: "approved", resolved_at: resolved, verification_answers: {} } as unknown as Evaluation);
  assert.deepEqual(released.slice(-2).map(event => event.key), ["tlAnswersClean", "tlReleased"]);
  const plain = caseTimeline({ ...base, status: "approved", cooling_off_until: null, reasons: [], context: {} } as unknown as Evaluation);
  assert.deepEqual(plain.map(event => event.key), ["tlSent", "tlDecisionApproved"]);
});

test("the police report escapes saved text and cites the law", () => {
  const html = policeReportHtml(base, "ru", key => key);
  assert.ok(html.includes("Банк не звонил &lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("О платежах и платёжных системах") && html.includes("232-1"));
  assert.ok(html.includes("KZ** •••• 0003") && !html.includes("biometr"));
});

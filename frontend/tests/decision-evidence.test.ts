import assert from "node:assert/strict";
import test from "node:test";
import type { Evaluation, Reason } from "../src/lib/contracts";
import { decisionEvidence } from "../src/lib/decision-evidence";
import { evidenceReasonLabel, evidenceText } from "../src/lib/decision-evidence-copy";

const reason = (code: string, layer = "behavioral", score_delta = 10): Reason => ({ code, layer, score_delta, reason_kk: `${code} қазақша`, reason_ru: `${code} по-русски` });
const saved = (codes: string[], status: Evaluation["status"] = "cooling_off", ml_score: number | null = 82) => ({ status, reasons: codes.map(code => reason(code)), ml_score });

test("behavioral hold explains scrutiny without inventing network proof, even with high ML", () => {
  const detail = saved(["ACTIVE_CALL", "PASTED_DURING_CALL", "NEW_RECIPIENT", "ML_RISK_UPLIFT"]);
  const before = JSON.stringify(detail);
  const value = decisionEvidence(detail);
  assert.equal(value.focus, "behavioralHold");
  assert.equal(value.groups.context.length, 3);
  assert.equal(value.groups.ml.length, 1);
  assert.equal(value.groups.network.length, 0);
  assert.equal(value.mlAvailable, true);
  assert.equal(JSON.stringify(detail), before);
  assert.match(evidenceText("ru", value.focus), /не доказывает/);
});

test("flag policy is explicit with low ML, including a flag found at hold release", () => {
  for (const code of ["RECIPIENT_FLAGGED", "RECIPIENT_FLAGGED_AT_RELEASE"]) {
    const value = decisionEvidence(saved([code], "blocked", 1));
    assert.equal(value.focus, "flagged");
    assert.equal(value.groups.network.length, 1);
    assert.equal(value.groups.ml.length, 0, "ML availability does not create another risk reason");
    assert.match(evidenceText("ru", value.focus), /На момент решения/);
    assert.match(evidenceText("ru", value.focus), /Низкая оценка ML не отменяет/);
  }
  assert.equal(decisionEvidence(saved(["RECIPIENT_FLAGGED", "QUESTIONNAIRE_PASSED"], "approved")).focus, "snapshot");
});

test("silent alarm and questionnaire blocks are never renamed as recipient flags", () => {
  assert.equal(decisionEvidence(saved(["DURESS_SIGNAL"], "blocked")).focus, "duress");
  assert.equal(decisionEvidence(saved(["DURESS_SIGNAL", "RECIPIENT_FLAGGED"], "blocked")).focus, "duress");
  for (const code of ["QUESTIONNAIRE_RED_FLAG", "QUESTIONNAIRE"]) {
    const value = decisionEvidence(saved([code], "blocked"));
    assert.equal(value.focus, "questionnaire");
    assert.equal(value.groups.network.length, 0);
  }
});

test("server active-hold guard explains the inherited pause without asserting fraud", () => {
  const value = decisionEvidence(saved(["ACTIVE_HOLD_RETRY"], "cooling_off", 0));
  assert.equal(value.focus, "activeHold");
  assert.equal(value.groups.checks.length, 1);
  assert.equal(value.groups.context.length, 0, "server guard is not claimed to be browser telemetry");
  assert.match(evidenceText("ru", value.focus), /исходный срок/);
  assert.match(evidenceText("kk", value.focus), /дәлелі емес/);
  assert.notEqual(decisionEvidence(saved(["ACTIVE_HOLD_RETRY"], "blocked")).focus, "activeHold");
});

test("uncorroborated collection and known release rechecks retain their exact source reasons", () => {
  const collection = decisionEvidence(saved(["FAN_IN_UNCORROBORATED", "RECIPIENT_MANY_SENDERS"]));
  assert.equal(collection.focus, "collection");
  assert.equal(collection.groups.network.length, 2);
  const recheck = decisionEvidence(saved(["RELEASE_REVALIDATED", "RECHECK_RECIPIENT_TRANSIT_RATIO", "RELEASE_NETWORK_BLOCKED"], "blocked"));
  assert.equal(recheck.focus, "releaseNetwork");
  assert.equal(recheck.groups.network[0].code, "RECHECK_RECIPIENT_TRANSIT_RATIO");
  assert.equal(recheck.groups.checks.length, 2);
});

test("unknown codes remain visible even when their claimed layer looks familiar", () => {
  const detail = saved(["ACTIVE_CALL"]);
  detail.reasons.push(reason("NEW_UNKNOWN_RULE", "graph"), reason("RECHECK_NEW_UNKNOWN_RULE", "revalidation"));
  const value = decisionEvidence(detail);
  assert.equal(value.incomplete, true);
  assert.equal(value.focus, "snapshot", "unknown evidence must prevent a behavioral-only conclusion");
  assert.equal(value.groups.unknown.length, 2);
  assert.equal(value.groups.network.length, 0);
});

test("missing reasons and missing ML never become evidence that risk is absent", () => {
  const value = decisionEvidence(saved([], "blocked", null));
  assert.equal(value.incomplete, true);
  assert.equal(value.focus, "snapshot");
  assert.equal(value.mlAvailable, false);
  assert.equal(decisionEvidence(saved([], "approved", 0)).mlAvailable, true);
  assert.equal(decisionEvidence(saved([], "approved", Number.NaN)).mlAvailable, false);
  assert.equal(decisionEvidence(saved([], "approved", Infinity)).mlAvailable, false);
  assert.match(evidenceText("ru", "absent"), /В ответе/);
});

test("bilingual headings and count labels stay readable without duplicate model counts", () => {
  for (const key of ["title", "context", "network", "ml", "unknown", "stale", "incomplete", "details", "mlRole"] as const) {
    assert.ok(evidenceText("kk", key).trim());
    assert.ok(evidenceText("ru", key).trim());
    assert.notEqual(evidenceText("kk", key), evidenceText("ru", key));
  }
  assert.equal(evidenceReasonLabel("ru", 1), "причина");
  assert.equal(evidenceReasonLabel("ru", 3), "причины");
  assert.equal(evidenceReasonLabel("ru", 11), "причин");
  assert.equal(evidenceReasonLabel("ru", 21), "причина");
  assert.equal(evidenceReasonLabel("kk", 1), "себеп");
  assert.equal(evidenceReasonLabel("kk", 21), "себеп");
  const value = decisionEvidence(saved(["ML_RISK_UPLIFT"], "approved", 25));
  assert.equal(Object.values(value.groups).flat().length, 1);
});

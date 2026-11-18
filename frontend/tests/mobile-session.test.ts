import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileCoolingDrafts, shouldRestoreAttempt } from "../src/lib/mobile-session";
import { retainCoolingDraft } from "../src/lib/cooling-flow";
import { acceptsEvaluation } from "../src/lib/recovery";
import type { Answers, Evaluation } from "../src/lib/contracts";

const clean: Answers = { caller_claims_bank_or_police: false, asked_to_move_to_safe_account: false, asked_to_keep_secret_or_install_app: false, initiated_by_customer: true, knows_recipient_personally: true };

test("background recovery of the latest attempt cannot replace another actively reviewed case", () => {
  assert.equal(shouldRestoreAttempt("hold-b", "hold-b", "hold-a"), false);
  assert.equal(shouldRestoreAttempt("hold-b", "hold-b", "hold-b"), true);
  assert.equal(shouldRestoreAttempt("hold-b", "hold-b", null), true);
  assert.equal(shouldRestoreAttempt("hold-a", "hold-b", null), false);
  assert.equal(shouldRestoreAttempt("hold-b", null, null), false);
});

test("a matching server save consumes a draft so reopening uses newer authoritative answers", () => {
  const draft = retainCoolingDraft({}, "hold-a", clean);
  const saved = reconcileCoolingDrafts(draft, { transaction_id: "hold-a", status: "cooling_off", verification_answers: clean });
  assert.equal(saved["hold-a"], undefined);
  const elsewhere = { ...clean, knows_recipient_personally: false };
  const refreshed = reconcileCoolingDrafts(saved, { transaction_id: "hold-a", status: "cooling_off", verification_answers: elsewhere });
  assert.deepEqual(refreshed["hold-a"] ?? elsewhere, elsewhere);
  assert.deepEqual(draft["hold-a"], clean, "reconciliation never mutates earlier snapshots");
});

test("a delayed questionnaire read cannot overwrite unsent edits or another case's draft", () => {
  const edited = { ...clean, asked_to_move_to_safe_account: true };
  const drafts = retainCoolingDraft(retainCoolingDraft({}, "hold-a", edited), "hold-b", { caller_claims_bank_or_police: false });
  const unchanged = reconcileCoolingDrafts(drafts, { transaction_id: "hold-a", status: "cooling_off", verification_answers: clean });
  assert.equal(unchanged, drafts);
  assert.equal(unchanged["hold-a"].asked_to_move_to_safe_account, true);
  const otherSaved = reconcileCoolingDrafts(unchanged, { transaction_id: "hold-b", status: "cooling_off", verification_answers: clean });
  assert.equal(otherSaved, unchanged, "partial local answers remain explicit even if another client completes the form");
});

test("terminal cancellation deletes only its draft and stale held results cannot recreate it", () => {
  const drafts = retainCoolingDraft(retainCoolingDraft({}, "hold-a", clean), "hold-b", clean);
  const cancelled = { transaction_id: "hold-a", status: "cancelled", verification_answers: null, server_time: "2026-11-17T12:05:00Z" } as Evaluation;
  const afterCancel = reconcileCoolingDrafts(drafts, cancelled);
  assert.equal(afterCancel["hold-a"], undefined);
  assert.deepEqual(afterCancel["hold-b"], clean);
  const stale = { ...cancelled, status: "cooling_off", verification_answers: clean, server_time: "2026-11-17T12:04:00Z" } as Evaluation;
  assert.equal(acceptsEvaluation(stale, undefined, cancelled), false);
  assert.equal(reconcileCoolingDrafts(afterCancel, stale), afterCancel, "reads never create cache entries");
});

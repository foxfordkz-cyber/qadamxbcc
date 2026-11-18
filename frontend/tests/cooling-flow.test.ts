import assert from "node:assert/strict";
import { test } from "node:test";
import { completeCoolingAnswers, firstCoolingStep, retainCoolingDraft } from "../src/lib/cooling-flow";
import { answersSchema, type Answers } from "../src/lib/contracts";

const clean: Answers = { caller_claims_bank_or_police: false, asked_to_move_to_safe_account: false, asked_to_keep_secret_or_install_app: false, initiated_by_customer: true, knows_recipient_personally: true };

test("five explicit boolean answers are required; a negative answer is never mistaken for missing", () => {
  assert.equal(completeCoolingAnswers({}), false);
  const { knows_recipient_personally: omitted, ...partial } = clean;
  assert.equal(completeCoolingAnswers(partial), false);
  assert.equal(completeCoolingAnswers(clean), true);
  assert.equal(completeCoolingAnswers({ ...clean, knows_recipient_personally: false }), true);
  assert.equal(answersSchema.safeParse(partial).success, false);
  assert.equal(answersSchema.safeParse(clean).success, true);
  assert.equal(omitted, true);
});

test("reopening a partial questionnaire resumes the first unanswered question; complete drafts reopen review", () => {
  assert.equal(firstCoolingStep({}), -1);
  assert.equal(firstCoolingStep({ caller_claims_bank_or_police: false }), 1);
  assert.equal(firstCoolingStep({ ...clean, asked_to_keep_secret_or_install_app: undefined }), 2);
  assert.equal(firstCoolingStep(clean), 5);
});

test("unsent edits remain isolated by operation ID when the modal closes or another hold opens", () => {
  const first = retainCoolingDraft({}, "hold-a", { caller_claims_bank_or_police: false });
  const second = retainCoolingDraft(first, "hold-b", clean);
  const updated = retainCoolingDraft(second, "hold-a", { ...first["hold-a"], asked_to_move_to_safe_account: true });
  assert.deepEqual(updated["hold-b"], clean);
  assert.deepEqual(updated["hold-a"], { caller_claims_bank_or_police: false, asked_to_move_to_safe_account: true });
  assert.deepEqual(first["hold-a"], { caller_claims_bank_or_police: false });
});

test("the in-memory draft cache is bounded and retains only questionnaire fields", () => {
  let drafts = {};
  for (let index = 0; index < 255; index++) drafts = retainCoolingDraft(drafts, `hold-${index}`, clean);
  assert.equal(Object.keys(drafts).length, 250);
  assert.equal("hold-0" in drafts, false);
  assert.equal("hold-254" in drafts, true);
  const untrusted = { ...clean, pasted_recipient: true, recipient: "+77010000000" };
  const bounded = retainCoolingDraft(drafts, "latest", untrusted, 1);
  assert.deepEqual(Object.keys(bounded), ["latest"]);
  assert.deepEqual(bounded.latest, clean);
});

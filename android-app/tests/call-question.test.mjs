import assert from "node:assert/strict";
import test from "node:test";
import { needsCallAnswer, submissionContext } from "../www/payee-check.mjs";

test("a legacy server receives compatible call flags and no new fields", () => {
  const draft = {payee: {manual: true}, amount: "100000", context: {active_call: false}};
  const checked = {status: "identified"};
  assert.equal(needsCallAnswer(draft, checked, false), true);
  assert.equal(needsCallAnswer({...draft, amount: "25000"}, checked, false), false);
  assert.equal(needsCallAnswer({...draft, payee: {manual: false}}, checked, false), false);
  assert.equal(needsCallAnswer(draft, {status: "mismatch"}, false), false);
  assert.deepEqual(submissionContext({...draft, callAnswer: "on_call"}, false), {active_call: true});
  assert.deepEqual(submissionContext({...draft, callAnswer: "after_call"}, false),
    {active_call: false, payment_requested_after_call: true});
});

test("the current server decides when to ask and manual testimony stays distinct from presets", () => {
  const draft = {payee: {manual: false}, amount: "95000", context: {}};
  assert.equal(needsCallAnswer(draft, {status: "identified", ask_about_call: false}, true), false);
  assert.equal(needsCallAnswer(draft, {status: "identified", ask_about_call: true}, true), true);
  assert.deepEqual(submissionContext(draft, true), {});
  assert.deepEqual(submissionContext({...draft, callAnswer: "no_request"}, true), {call_pressure_answer: "no_request"});
  assert.deepEqual(submissionContext({...draft, context: {active_call: true}}, true),
    {active_call: true, call_pressure_answer: "on_call"});
  assert.deepEqual(submissionContext({context: {active_call: true}}, true), {active_call: true});
});

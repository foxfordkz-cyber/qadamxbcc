import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BiometricSensor } from "../src/lib/biometrics";
import trial from "../src/lib/familiar-call-trial.json";

test("published paired cohorts use the shipped weights and identical denominators", () => {
  const weights = readFileSync(new URL("../../backend/app/ml/familiar_call.json", import.meta.url));
  assert.equal(createHash("sha256").update(weights).digest("hex"), trial.artifact_sha256);
  assert.equal(JSON.parse(weights.toString()).version, trial.candidate_version);
  assert.equal(trial.serving_mode, "observation");
  for (const { baseline, candidate, size } of Object.values(trial.cohorts)) {
    const fraud = baseline.caught + baseline.missed;
    const honest = baseline.false_pauses + baseline.honest_approved;
    assert.equal(size, fraud + honest);
    assert.equal(candidate.caught + candidate.missed, fraud);
    assert.equal(candidate.false_pauses + candidate.honest_approved, honest);
  }
});

test("sensor sums qualifying gaps and counts a deletion independently of its duration", () => {
  const sensor = new BiometricSensor();
  sensor.focus("recipient", 0);
  sensor.input("recipient", 1, "insertText", 1, 0);
  sensor.input("recipient", 2, "insertText", 1, 2000);
  sensor.input("recipient", 3, "insertText", 1, 5000);
  sensor.input("recipient", 2, "deleteContentBackward", 0, 5200);
  assert.equal(sensor.context().hesitation_ms, 5000);
  assert.equal(sensor.context().hesitation_count, 3);
  assert.equal(sensor.context().typing_duration_ms, 5200);
});

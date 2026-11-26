import assert from "node:assert/strict";
import { test } from "node:test";
import * as pitch from "../src/content/pitch-site";

test("the pitch slides add up to exactly five minutes and have unique anchors", () => {
  assert.equal(pitch.totalSeconds, 300);
  const ids = pitch.slides.map(slide => slide.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.filter(id => id.startsWith("how-")), pitch.how.steps.map((_, i) => `how-${i + 1}`));
});

test("every pitch string has both a Kazakh and a Russian version", () => {
  const seen: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value) && value.length === 2 && value.every(item => typeof item === "string")) {
      const [kk, ru] = value as [string, string];
      assert.ok(kk.trim() && ru.trim(), `${path} is empty`);
      seen.push(path);
      return;
    }
    if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i}]`));
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
  };
  for (const [name, value] of Object.entries(pitch)) walk(value, name);
  assert.ok(seen.length > 100, `only ${seen.length} bilingual strings found`);
});

test("evidence links point at files inside the repository", () => {
  for (const metric of pitch.proof.metrics) assert.match(metric.file, /^(docs\/|verify\.sh$)/);
  assert.match(pitch.REPO, /^https:\/\/github\.com\/.+\/blob\/.+\/$/);
});

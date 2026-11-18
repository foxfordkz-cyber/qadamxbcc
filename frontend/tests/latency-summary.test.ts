import assert from "node:assert/strict";
import { test } from "node:test";
import { latencySummary } from "../src/lib/latency-summary";

const row = (id: number, latency: number, age = 0) => ({
  transaction_id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  created_at: new Date(Date.parse("2026-11-17T10:00:00Z") - age).toISOString(),
  latency_ms: latency,
});

test("p95 excludes unmeasured seed rows and has no invented value before observations", () => {
  assert.deepEqual(latencySummary([]), { p95_latency_ms: null, latency_sample_size: 0, latency_sample_limit: 500 });
  assert.deepEqual(latencySummary([row(1, 0), row(2, NaN), row(3, Infinity), row(4, -1)]), latencySummary([]));
  assert.deepEqual(latencySummary([row(1, 0), row(2, 8.125)]), { p95_latency_ms: 8.125, latency_sample_size: 1, latency_sample_limit: 500 });
});

test("p95 uses nearest rank without interpolation and leaves source rows unchanged", () => {
  const rows = Array.from({ length: 20 }, (_, index) => row(index + 1, index + 1));
  const before = structuredClone(rows);
  assert.equal(latencySummary(rows).p95_latency_ms, 19);
  assert.deepEqual(rows, before);
});

test("p95 window chooses 500 latest created observations with deterministic identity ties", () => {
  const rows = [
    ...Array.from({ length: 30 }, (_, index) => row(index + 1, 9999)),
    ...Array.from({ length: 500 }, (_, index) => row(index + 31, index + 1)),
    ...Array.from({ length: 30 }, (_, index) => row(index + 1000, 9999, 1000)),
    ...Array.from({ length: 30 }, (_, index) => row(index + 2000, 0, -1000)),
  ];
  assert.deepEqual(latencySummary(rows), { p95_latency_ms: 475, latency_sample_size: 500, latency_sample_limit: 500 });
});

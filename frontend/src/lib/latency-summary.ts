export const LATENCY_SAMPLE_LIMIT = 500;
type TimedRow = { transaction_id: string; created_at: string; latency_ms: number };

/** Global scorer observations, excluding unmeasured seed rows; never a banking SLO. */
export function latencySummary(rows: readonly TimedRow[]) {
  const recent = rows.filter(row => Number.isFinite(row.latency_ms) && row.latency_ms > 0)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
      || (a.transaction_id === b.transaction_id ? 0 : a.transaction_id < b.transaction_id ? 1 : -1))
    .slice(0, LATENCY_SAMPLE_LIMIT).map(row => row.latency_ms).sort((a, b) => a - b);
  return {
    p95_latency_ms: recent.length ? Math.round(recent[Math.ceil(0.95 * recent.length) - 1] * 1000) / 1000 : null,
    latency_sample_size: recent.length,
    latency_sample_limit: LATENCY_SAMPLE_LIMIT,
  };
}

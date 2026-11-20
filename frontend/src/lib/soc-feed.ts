import type { Status } from "./contracts";

export const SOC_PAGE_SIZE = 25;
export const SOC_MAX_OFFSET = 100_000;

export function socFeedPath(status: Status | "all", query: string, offset: number, alertsOnly = false): string {
  const params = new URLSearchParams({ limit: String(SOC_PAGE_SIZE), offset: String(offset) });
  if (status !== "all") params.set("status", status);
  if (query.trim()) params.set("q", query.trim());
  if (alertsOnly) params.set("alerts_only", "true");
  return `soc/feed?${params}`;
}

/** Keep a chosen case stable when pages, filters or fresh transfers change. */
export function initialCaseSelection(selected: string | null, ids: string[]): string | null {
  return selected ?? ids[0] ?? null;
}

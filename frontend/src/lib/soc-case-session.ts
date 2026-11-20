import { z } from "zod";
import type { CaseAction, CaseOut } from "./soc-integrations";

export const CASE_SESSION_KEY = "saq-bol-soc-cases-v1";
export const caseStates = ["NEW", "IN_REVIEW", "NEEDS_INFORMATION", "ESCALATED", "RESOLVED", "CLOSED"] as const;
export const caseStaff = ["demo_analyst_a", "demo_analyst_b"] as const;
export const caseCategories = ["impersonation", "safe_account", "remote_access", "other"] as const;
export const caseQuestions = ["caller_request", "remote_access", "secrecy_pressure"] as const;
export const caseReasons = ["review_started", "needs_followup", "review_complete", "duplicate", "reopened"] as const;
const sessionSchema = z.object({
  selectedId: z.uuid().nullable().default(null),
  status: z.enum(["all", ...caseStates]).default("all"),
  assignee: z.enum(["all", "unassigned", ...caseStaff]).default("all"),
  since: z.string().regex(/^(?:|\d{4}-\d{2}-\d{2})$/).default(""),
  pending: z.object({ caseId: z.uuid().nullable(), key: z.uuid(), action: z.enum(["open", "assign", "transition", "note", "request_information", "categorize"]) }).nullable().default(null),
});
export type CaseSession = z.infer<typeof sessionSchema>;
export const emptyCaseSession: CaseSession = { selectedId: null, status: "all", assignee: "all", since: "", pending: null };
export function readCaseSession(raw: string | null): CaseSession {
  try { return sessionSchema.parse(JSON.parse(raw ?? "{}")); } catch { return { ...emptyCaseSession }; }
}
/** Allowlist only IDs, filters and an unresolved-action marker. Never persist notes or tokens. */
export function serializeCaseSession(value: CaseSession): string { return JSON.stringify(sessionSchema.parse(value)); }
export function filterCases(items: readonly CaseOut[], filters: Pick<CaseSession, "status" | "assignee" | "since">) {
  const since = filters.since ? Date.parse(`${filters.since}T00:00:00+05:00`) : NaN;
  return items.filter(item => (filters.status === "all" || item.state === filters.status)
    && (filters.assignee === "all" || (filters.assignee === "unassigned" ? item.assignee === null : item.assignee === filters.assignee))
    && (!Number.isFinite(since) || Date.parse(item.created_at) >= since));
}
export const caseTransitions: Record<CaseOut["state"], readonly CaseOut["state"][]> = {
  NEW: ["IN_REVIEW", "ESCALATED", "CLOSED"], IN_REVIEW: ["ESCALATED", "RESOLVED", "CLOSED"],
  NEEDS_INFORMATION: ["IN_REVIEW", "ESCALATED", "CLOSED"], ESCALATED: ["IN_REVIEW", "RESOLVED", "CLOSED"],
  RESOLVED: ["IN_REVIEW", "CLOSED"], CLOSED: ["IN_REVIEW"],
};
export function actionAllowed(current: CaseOut, action: CaseAction): boolean {
  if (Date.parse(current.expires_at) <= Date.now() || current.version >= 500) return false;
  if (action.action === "transition") return caseTransitions[current.state].includes(action.state)
    && (current.state !== "CLOSED" || action.reason === "reopened");
  if (current.state === "CLOSED" || current.state === "RESOLVED") return false;
  if (action.action === "request_information") return current.source === "owner_demo" && ["IN_REVIEW", "ESCALATED"].includes(current.state);
  return true;
}
export type CaseIntent = { caseId: string | null; key: string; body: CaseAction | { report_id: string }; createdAt: number };
export function intentMarker(intent: CaseIntent): NonNullable<CaseSession["pending"]> {
  return { caseId: intent.caseId, key: intent.key, action: "action" in intent.body ? intent.body.action : "open" };
}
/** A conflict creates no request. Only a later explicit confirmation may use this fresh body. */
export function rebaseCaseAction(intent: CaseIntent, current: CaseOut): CaseAction | null {
  if (intent.caseId !== current.id || !("action" in intent.body)) return null;
  const body = { ...intent.body, expected_version: current.version };
  return actionAllowed(current, body) ? body : null;
}
export function mergeCases(previous: readonly CaseOut[], incoming: readonly CaseOut[]) {
  const values = new Map(previous.map(item => [item.id, item]));
  for (const item of incoming) if (!values.has(item.id) || values.get(item.id)!.version <= item.version) values.set(item.id, item);
  return [...values.values()];
}

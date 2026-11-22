import { z } from "zod";
import { privateStorySchema } from "./transfer-story";

const id = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
export const outcomeReasons = ["confirmed_fraud", "legitimate_transfer", "insufficient_evidence"] as const;
const policyComparisonSchema = z.object({
  sampled: count.max(100), evaluated: count.max(100), candidate_threshold: z.literal(35), extra_holds: count,
  fraud_labelled: count, legitimate_labelled: count, baseline_detected: count, candidate_detected: count,
  baseline_false_interventions: count, candidate_false_interventions: count,
  first_sample_at: timestamp.nullish(), last_sample_at: timestamp.nullish(),
  label_coverage: z.number().min(0).max(1).nullish(),
  policies: z.array(z.object({
    threshold: count.max(100).nullable(), extra_holds: count, missed_fraud: count.nullable(),
    false_interventions: count.nullable(), false_per_1000_legitimate: z.number().min(0).max(1000).nullable(),
  })).max(101).optional(),
});
export const caseStates = ["NEW", "IN_REVIEW", "NEEDS_INFORMATION", "ESCALATED", "RESOLVED", "CLOSED"] as const;
export const caseStaff = ["demo_analyst_a", "demo_analyst_b"] as const;
export const caseCategories = ["impersonation", "safe_account", "remote_access", "other"] as const;
export const caseQuestions = ["caller_request", "remote_access", "secrecy_pressure"] as const;
const state = z.enum(caseStates);
const staff = z.enum(caseStaff).nullable();
const category = z.enum(caseCategories);
const source = z.enum(["owner_demo", "trusted_contact"]);
const version = z.number().int().min(1);
const descriptions = { description_ru: z.string(), description_kk: z.string() };
export const caseSchema = z.object({ id, report_id: id, source, category, state, assignee: staff, version,
  created_at: timestamp, status_since: timestamp, expires_at: timestamp, demonstration_only: z.literal(true) });
export const casePageSchema = z.object({ items: z.array(caseSchema).max(100), next_cursor: z.string().max(500).nullable() });
export const caseAnalyticsSchema = z.object({ as_of: timestamp, total: count, open: count, closed: count,
  by_state: z.record(z.string(), count), by_source: z.record(z.string(), count), escalated_cases: count,
  manually_reviewed_cases: count, manual_review_share: z.number().min(0).max(1),
  oldest_current_status_seconds: z.record(z.string(), z.number().nonnegative()), demonstration_only: z.literal(true),
  policy_comparison: policyComparisonSchema.nullish() });
export const caseHistorySchema = z.object({ items: z.array(z.object({ id, actor_id: id, version, code: z.string(),
  actor_role: z.enum(["soc", "owner"]), timestamp, state, category, assignee: staff, reason: z.string().nullable(), ...descriptions })).max(100),
  next_after_version: count.nullable() });
export const caseNotesSchema = z.object({ items: z.array(z.object({ event_id: id, body: z.string().max(500), expires_at: timestamp })).max(100), next_after_version: count.nullable() });
const auditSchema = z.object({ event: z.string(), correlation_id: id, created_at: timestamp });
export const caseEvidenceSchema = z.object({ report_available: z.boolean(), transaction_id: id.nullable(), report_events: z.array(auditSchema).max(20), advisory_only: z.literal(true) });
export const caseExportSchema = z.object({ category, state, source, created_at: timestamp,
  events: z.array(z.object({ code: z.string(), state, timestamp })).max(500), demonstration_only: z.literal(true) });
export const openCaseSchema = z.object({ report_id: id }).strict();
const safeText = z.string().trim().min(10).max(500).refine(value => !/[\p{C}]|\p{Nd}{4,}|https?:\/\/|@|\b(?:pin|cvv|cvc|otp|password)\b|парол|құпиясөз/iu.test(value), "Use synthetic text without personal details or secrets");
export const caseActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), expected_version: version, assignee: staff }).strict(),
  z.object({ action: z.literal("categorize"), expected_version: version, category }).strict(),
  z.object({ action: z.literal("note"), expected_version: version, body: safeText }).strict(),
  z.object({ action: z.literal("request_information"), expected_version: version, question: z.enum(caseQuestions) }).strict(),
  z.object({ action: z.literal("transition"), expected_version: version, state,
    reason: z.enum(["review_started", "needs_followup", "review_complete", "duplicate", "reopened", ...outcomeReasons]) }).strict(),
]);
const timelineEventSchema = z.object({ id: z.string(), timestamp, category: z.enum(["core", "contact", "gateway", "orchestration"]),
    importance: z.enum(["information", "attention"]), code: z.string(), correlation_id: id.nullable(), ...descriptions,
    source: z.enum(["persisted_core", "integration_audit"]) });
export const incidentTimelineSchema = z.object({ transaction_id: id, as_of: timestamp,
  events: z.array(timelineEventSchema).max(100),
  next_cursor: z.string().max(1024).nullable(), advisory_only: z.literal(true) });
export const integrationHealthSchema = z.object({ status: z.enum(["ok", "degraded"]), checked_at: timestamp, cache_seconds: z.literal(5),
  database: z.enum(["ok", "unavailable"]), redis: z.enum(["ok", "unavailable"]), worker: z.enum(["ok", "not_seen", "unknown"]),
  telegram: z.enum(["disabled", "fake_enabled", "test_enabled"]), gateway: z.enum(["disabled", "mock_ready"]),
  queue: z.object({ notifications_queued: count, notifications_delayed: count, notifications_failed: count, runs_pending: count }).nullable(),
  last_successful_processing: timestamp.nullable(), real_provider_probed: z.literal(false) });
const notificationState = z.enum(["NOTIFICATION_QUEUED", "NOTIFICATION_SENT", "DELIVERY_FAILED", "CONTACT_ACKNOWLEDGED", "SUSPICION_REPORTED", "CONTACT_REVOKED", "NOTIFICATION_EXPIRED"]);
const notificationSchema = z.object({ id, contact_id: id, transaction_id: id, correlation_id: id, state: notificationState,
  expires_at: timestamp, error_code: z.string().nullable(), attempts: count, next_attempt_at: timestamp.nullable(), advisory_only: z.literal(true) });
const gatewayError = z.enum(["UNKNOWN_IDENTIFIER", "INTERNAL_SERVICE_ERROR", "GATEWAY_UNAVAILABLE", "TIMEOUT", "MALFORMED_RESPONSE", "EXPIRED_RESULT", "UNVERIFIED_RESPONSE", "INCOMPLETE_CHECK"]);
const gatewayResultSchema = z.object({ source: z.literal("MOCK"), identifier: z.string().regex(/^SYN-[A-Z0-9-]{1,40}$/),
  status: z.enum(["CLEAR", "INDICATORS", "UNKNOWN", "UNAVAILABLE"]), markers: z.array(z.enum(["SYNTHETIC_REVIEW", "SYNTHETIC_NETWORK_SIGNAL"])),
  checked_at: timestamp, expires_at: timestamp, verified: z.boolean(), error_code: gatewayError.nullable(), advisory_only: z.literal(true) });
const externalCheckSchema = z.object({ id, correlation_id: id, transaction_id: id.nullable(),
  result: gatewayResultSchema, fresh: z.boolean(), cache_hit: z.boolean(), ...descriptions });
export const integrationSummarySchema = z.object({ transaction_id: id, core_status: z.enum(["approved", "cooling_off", "blocked", "cancelled"]),
  run: z.object({ id, transaction_id: id, correlation_id: id, state: z.enum(["QUEUED", "RUNNING", "COMPLETE", "DEGRADED", "FAILED"]),
    contact_outcome: z.string(), notification_id: id.nullable(), external_check_id: id.nullable(), attempts: count,
    error_code: z.string().nullable(), created_at: timestamp, advisory_only: z.literal(true) }).nullable(),
  notifications: z.array(notificationSchema), external_checks: z.array(externalCheckSchema).max(100),
  events: z.array(auditSchema).max(300), source: z.literal("MOCK"), advisory_only: z.literal(true) });
export const incidentSummarySchema = z.object({ transaction_id: id, core_status: z.enum(["approved", "cooling_off", "blocked", "cancelled"]),
  cooling_until: timestamp.nullable(), cooling_active: z.boolean(),
  consents: z.array(z.object({ contact_id: id, state: z.string(), consented: z.boolean(), notifications_enabled: z.boolean() })).max(101),
  notifications: z.array(notificationSchema).max(100), gateway_results: z.array(externalCheckSchema).max(10),
  recent_events: z.array(timelineEventSchema).max(10), manual_review_reasons: z.array(z.string()),
  manual_review_requested: z.boolean(), ...descriptions, health: integrationHealthSchema, advisory_only: z.literal(true) });

export type CaseOut = z.infer<typeof caseSchema>;
export type CasePage = z.infer<typeof casePageSchema>;
export type CaseAnalytics = z.infer<typeof caseAnalyticsSchema>;
export type CaseAction = z.infer<typeof caseActionSchema>;
export type EventPage = z.infer<typeof caseHistorySchema>;
export type ContentPage = z.infer<typeof caseNotesSchema>;
export type CaseEvidence = z.infer<typeof caseEvidenceSchema>;
export type CaseExport = z.infer<typeof caseExportSchema>;
export type IncidentTimeline = z.infer<typeof incidentTimelineSchema>;
export type IntegrationHealth = z.infer<typeof integrationHealthSchema>;
export type IntegrationSummary = z.infer<typeof integrationSummarySchema>;
export type IncidentSummary = z.infer<typeof incidentSummarySchema>;

/** Undefined means this is not one of the SOC integration routes owned here. */
export function socIntegrationSchema(path: string): z.ZodType | undefined {
  const route = path.split("?")[0];
  if (route === "integrations/guardian/soc/cases") return casePageSchema;
  if (/^integrations\/soc\/transactions\/[0-9a-f-]{36}\/story$/i.test(route)) return privateStorySchema;
  if (route === "integrations/guardian/soc/cases/analytics") return caseAnalyticsSchema;
  const caseMatch = /^integrations\/guardian\/soc\/cases\/([0-9a-f-]{36})(?:\/(actions|history|notes|evidence|export))?$/i.exec(route);
  if (caseMatch) return ({ history: caseHistorySchema, notes: caseNotesSchema, evidence: caseEvidenceSchema, export: caseExportSchema } as Record<string, z.ZodType>)[caseMatch[2]] ?? caseSchema;
  if (/^integrations\/soc\/transactions\/[0-9a-f-]{36}\/timeline$/i.test(route)) return incidentTimelineSchema;
  if (/^integrations\/soc\/transactions\/[0-9a-f-]{36}\/summary$/i.test(route)) return incidentSummarySchema;
  if (/^integrations\/soc\/transactions\/[0-9a-f-]{36}$/i.test(route)) return integrationSummarySchema;
  if (route === "integrations/health/details") return integrationHealthSchema;
  return undefined;
}

export function validateSocIntegrationResponse(path: string, value: unknown, method = "GET"): unknown {
  const route = path.split("?")[0];
  const schema = route === "integrations/guardian/soc/cases" && method === "POST" ? caseSchema : socIntegrationSchema(path);
  if (!schema) return value;
  const result = schema.parse(value);
  const caseMatch = /^integrations\/guardian\/soc\/cases\/([0-9a-f-]{36})(?:\/actions)?$/i.exec(route);
  const txMatch = /^integrations\/soc\/transactions\/([0-9a-f-]{36})(?:\/(?:timeline|summary|story))?$/i.exec(route);
  if (caseMatch && (result as CaseOut).id.toLowerCase() !== caseMatch[1].toLowerCase()) throw new Error("Mismatched case response");
  if (txMatch && (result as IntegrationSummary).transaction_id.toLowerCase() !== txMatch[1].toLowerCase()) throw new Error("Mismatched transaction response");
  return result;
}

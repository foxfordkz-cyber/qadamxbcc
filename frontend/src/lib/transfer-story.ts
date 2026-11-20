import { z } from "zod";
import { caseTimeline } from "./case-timeline";
import type { Evaluation } from "./contracts";

const guardianCodes = ["NOTIFICATION_QUEUED", "NOTIFICATION_RETRY", "NOTIFICATION_SENT", "DELIVERY_FAILED",
  "CONTACT_ACKNOWLEDGED", "SUSPICION_REPORTED", "CONTACT_REVOKED", "NOTIFICATION_EXPIRED"] as const;
const caseCodes = ["CASE_OPENED", "CASE_ASSIGN", "CASE_REQUEST_INFORMATION", "CASE_NEW", "CASE_IN_REVIEW",
  "CASE_NEEDS_INFORMATION", "CASE_ESCALATED", "CASE_RESOLVED", "CASE_CLOSED"] as const;
const timestamp = z.iso.datetime({ offset: true });
const privateEvent = z.discriminatedUnion("role", [
  z.object({ role: z.literal("customer"), code: z.literal("OWNER_REPORT_SUBMITTED"), timestamp }).strict(),
  z.object({ role: z.literal("guardian"), code: z.enum(guardianCodes), timestamp }).strict(),
  z.object({ role: z.literal("soc"), code: z.enum(caseCodes), timestamp }).strict(),
]);
export const privateStorySchema = z.object({
  transaction_id: z.uuid(), events: z.array(privateEvent).max(40), truncated: z.boolean(),
}).strict();
export type PrivateStory = z.infer<typeof privateStorySchema>;

const customerReasons = ["POST_CALL_ENDED", "POST_CALL_RECOGNIZED", "POST_CALL_SCAM_REPORTED",
  "RETURN_REDIRECT_REPORTED", "RETURN_APPEAL_REQUESTED"] as const;
const reviewReasons = ["RETURN_REVIEW_CLEARED", "RETURN_REVIEW_UPHELD"] as const;
const lifecycle = {
  tlSent: "EVALUATED", tlDecisionHeld: "HELD", tlDecisionApproved: "APPROVED", tlDecisionBlocked: "BLOCKED",
  tlReleased: "RELEASED", tlStopped: "STOPPED", tlCancelled: "CANCELLED",
} as const;
type PrivateCode = PrivateStory["events"][number]["code"];
export type StoryCode = PrivateCode | typeof customerReasons[number] | typeof reviewReasons[number] | typeof lifecycle[keyof typeof lifecycle];
export type StoryRole = "customer" | "guardian" | "soc";
export interface StoryStep { role: StoryRole; code: StoryCode; timestamp: string | null }

export function selectedStory(detail: Evaluation, privateStory: PrivateStory | null): StoryStep[] {
  const steps: StoryStep[] = [];
  for (const event of caseTimeline(detail)) {
    if (Object.hasOwn(lifecycle, event.key)) {
      steps.push({ role: "customer", code: lifecycle[event.key as keyof typeof lifecycle], timestamp: event.time });
    }
  }
  const authorized = privateStory?.transaction_id === detail.transaction_id ? privateStory : null;
  for (const reason of detail.reasons) {
    const customer = customerReasons.find(code => code === reason.code);
    const review = authorized && reviewReasons.find(code => code === reason.code);
    const code = customer || review;
    if (!code) continue;
    const saved = timestamp.safeParse(reason.evidence?.recorded_at);
    steps.push({ role: customer ? "customer" : "soc", code, timestamp: saved.success ? saved.data : null });
  }
  if (authorized) steps.push(...authorized.events);
  // Undated legacy observations remain visible, separate from the timed sequence.
  function order(a: StoryStep, b: StoryStep) {
    if (!a.timestamp || !b.timestamp) return Number(!a.timestamp) - Number(!b.timestamp);
    const millis = Date.parse(a.timestamp) - Date.parse(b.timestamp);
    if (millis) return millis;
    // Browser Date rounds the database's microseconds. Preserve sub-millisecond order.
    const fraction = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0");
    const micros = fraction(a.timestamp).localeCompare(fraction(b.timestamp));
    if (micros) return micros;
    const final = (step: StoryStep) => ["CANCELLED", "STOPPED", "RELEASED"].includes(step.code);
    return Number(final(a)) - Number(final(b));
  }
  return steps.sort(order);
}

// Snapshot of seed_soc_rehearsal with the offline fake provider on 2026-11-20.
// Only the synthetic transfer reference, amount, risk decision and timestamped action codes survive export.
export const rehearsalStory = {
  transaction_id: "55002e4d-d558-44b4-bd13-daa9b9b33d46", amount: 900000, risk_score: 74,
  steps: [
    { role: "customer", code: "EVALUATED", timestamp: "2026-11-20T11:20:57.115556Z" },
    { role: "customer", code: "HELD", timestamp: "2026-11-20T11:20:57.115556Z" },
    { role: "guardian", code: "NOTIFICATION_QUEUED", timestamp: "2026-11-20T11:20:57.583097Z" },
    { role: "guardian", code: "NOTIFICATION_SENT", timestamp: "2026-11-20T11:20:57.643880Z" },
    { role: "guardian", code: "SUSPICION_REPORTED", timestamp: "2026-11-20T11:20:57.882430Z" },
    { role: "customer", code: "OWNER_REPORT_SUBMITTED", timestamp: "2026-11-20T11:20:58.418706Z" },
    { role: "soc", code: "CASE_OPENED", timestamp: "2026-11-20T11:20:58.441705Z" },
  ] satisfies StoryStep[],
};

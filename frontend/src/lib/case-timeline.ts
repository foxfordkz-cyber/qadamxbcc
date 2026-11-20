import type { Evaluation } from "./contracts";

/** One step of a transfer's story for the SOC analyst and the police report. */
export type TimelineKey = "tlSent" | "tlSignals" | "tlBankLog" | "tlNetwork" | "tlDuress" | "tlDecisionHeld" | "tlDecisionBlocked" | "tlDecisionApproved"
  | "tlAnswersClean" | "tlAnswersFlag" | "tlCancelled" | "tlReleased" | "tlStopped" | "tlHoldUntil";
export type SignalKey = "active_call" | "from_deposit" | "is_new_device" | "is_new_recipient" | "pasted_recipient";
export interface TimelineEvent { key: TimelineKey; time: string | null; tone: "info" | "risk" | "safe" | "planned"; signals?: SignalKey[]; score?: number }

const signalKeys: SignalKey[] = ["active_call", "from_deposit", "is_new_device", "is_new_recipient", "pasted_recipient"];
const networkCodes = new Set(["DROP_HUB_FAN_IN", "FAN_IN_VELOCITY", "FAN_IN_UNCORROBORATED", "RECIPIENT_FLAGGED", "RECIPIENT_INSTANT_CASHOUT", "RECIPIENT_MANY_SENDERS", "RECIPIENT_SHARED_DEVICE", "RECIPIENT_TRANSIT_RATIO"]);
const valid = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? value : null;

/**
 * Built only from the saved decision record, so the same story is shown in the demo,
 * the static Pages build and the live backend. Nothing is inferred that the record lacks.
 */
export function caseTimeline(detail: Evaluation): TimelineEvent[] {
  const created = valid(detail.created_at);
  const codes = new Set(detail.reasons.map(reason => reason.code));
  const events: TimelineEvent[] = [{ key: "tlSent", time: created, tone: "info" }];
  const signals = signalKeys.filter(key => detail.context?.[key] === true);
  if (signals.length) events.push({ key: "tlSignals", time: created, tone: "risk", signals });
  if (codes.has("DURESS_SIGNAL")) events.push({ key: "tlDuress", time: created, tone: "risk" });
  if (codes.has("BANK_CALL_DENIED")) events.push({ key: "tlBankLog", time: created, tone: "risk" });
  if ([...codes].some(code => networkCodes.has(code))) events.push({ key: "tlNetwork", time: created, tone: "risk" });
  const answered = codes.has("QUESTIONNAIRE_PASSED") || codes.has("QUESTIONNAIRE_RED_FLAG") || detail.verification_answers != null;
  const wasHeld = detail.status === "cooling_off" || valid(detail.cooling_off_until) !== null || answered || detail.status === "cancelled";
  const first = wasHeld ? "tlDecisionHeld" : detail.status === "blocked" ? "tlDecisionBlocked" : "tlDecisionApproved";
  // The record keeps the current score; for a resolved hold it already includes the answers.
  events.push({ key: first, time: created, tone: first === "tlDecisionApproved" ? "safe" : "risk", ...(answered ? {} : { score: detail.risk_score }) });
  const resolved = valid(detail.resolved_at);
  const later = resolved ?? valid(detail.updated_at);
  if (answered) events.push({ key: codes.has("QUESTIONNAIRE_RED_FLAG") ? "tlAnswersFlag" : "tlAnswersClean", time: later, tone: codes.has("QUESTIONNAIRE_RED_FLAG") ? "risk" : "safe" });
  if (wasHeld && detail.status === "cancelled") events.push({ key: "tlCancelled", time: resolved, tone: "safe" });
  else if (wasHeld && detail.status === "approved") events.push({ key: "tlReleased", time: resolved, tone: "safe", score: detail.risk_score });
  else if (wasHeld && detail.status === "blocked") events.push({ key: "tlStopped", time: resolved, tone: "risk", score: detail.risk_score });
  if (detail.status === "cooling_off" && valid(detail.cooling_off_until)) events.push({ key: "tlHoldUntil", time: detail.cooling_off_until!, tone: "planned" });
  return events;
}

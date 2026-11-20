import type { Evaluation, Reason } from "./contracts";

export type EvidenceGroup = "context" | "network" | "checks" | "ml" | "unknown";
export type EvidenceFocus = "snapshot" | "behavioralHold" | "activeHold" | "flagged" | "duress" | "questionnaire" | "releaseNetwork" | "collection";

const contextCodes = new Set([
  "ACTIVE_CALL", "PASTED_DURING_CALL", "BANK_CALL_DENIED", "DEPOSIT_WITHDRAWAL", "NEW_RECIPIENT",
  "AMOUNT_SPIKE", "NEW_DEVICE", "NIGHT_HOURS", "SOCIAL_ENGINEERING_PATTERN", "ACCOUNT_TAKEOVER_PATTERN",
  "SENDER_BURST", "DURESS_SIGNAL",
]);
const networkCodes = new Set([
  "DROP_HUB_FAN_IN", "FAN_IN_VELOCITY", "RECIPIENT_MANY_SENDERS", "RECIPIENT_INSTANT_CASHOUT",
  "RECIPIENT_TRANSIT_RATIO", "SENDER_PASS_THROUGH", "RECIPIENT_SHARED_DEVICE", "SENDER_DEVICE_SHARED",
  "FAN_IN_UNCORROBORATED", "RECIPIENT_FLAGGED", "RECIPIENT_FLAGGED_AT_RELEASE",
]);
const checkCodes = new Set([
  "ACTIVE_HOLD_RETRY", "QUESTIONNAIRE", "QUESTIONNAIRE_RED_FLAG", "QUESTIONNAIRE_PASSED",
  "QUESTIONNAIRE_VERIFIED", "RELEASE_REVALIDATED", "RELEASE_NETWORK_BLOCKED", "CUSTOMER_CANCELLED",
]);
const recheckCodes = new Set([...networkCodes, "SENDER_BURST"]);

function groupFor(code: string): EvidenceGroup {
  if (contextCodes.has(code)) return "context";
  if (networkCodes.has(code)) return "network";
  // Only documented revalidation codes are recognized; arbitrary prefixes/layers
  // must not turn an unknown backend signal into claimed network evidence.
  if (code.startsWith("RECHECK_") && recheckCodes.has(code.slice(8))) return "network";
  if (checkCodes.has(code)) return "checks";
  if (code === "ML_RISK_UPLIFT") return "ml";
  return "unknown";
}

/** Summarizes the saved response only. Never scores, changes status, or reads live form toggles. */
export function decisionEvidence(detail: Pick<Evaluation, "status" | "reasons" | "ml_score">) {
  const groups: Record<EvidenceGroup, Reason[]> = { context: [], network: [], checks: [], ml: [], unknown: [] };
  for (const reason of detail.reasons) groups[groupFor(reason.code)].push(reason);
  const codes = new Set(detail.reasons.map(reason => reason.code));
  const incomplete = groups.unknown.length > 0 || (detail.status !== "approved" && detail.reasons.length === 0);
  const mlAvailable = typeof detail.ml_score === "number" && Number.isFinite(detail.ml_score);
  let focus: EvidenceFocus = "snapshot";
  if (detail.status === "blocked" && codes.has("DURESS_SIGNAL")) focus = "duress";
  else if (detail.status === "blocked" && (codes.has("RECIPIENT_FLAGGED") || codes.has("RECIPIENT_FLAGGED_AT_RELEASE"))) focus = "flagged";
  else if (detail.status === "blocked" && (codes.has("QUESTIONNAIRE_RED_FLAG") || codes.has("QUESTIONNAIRE"))) focus = "questionnaire";
  else if (detail.status === "blocked" && codes.has("RELEASE_NETWORK_BLOCKED")) focus = "releaseNetwork";
  else if (detail.status === "cooling_off" && codes.has("ACTIVE_HOLD_RETRY")) focus = "activeHold";
  else if (detail.status === "cooling_off" && !incomplete && groups.network.length === 0 && groups.context.length > 0
    && groups.checks.every(reason => reason.code === "QUESTIONNAIRE_VERIFIED")) focus = "behavioralHold";
  else if (detail.status === "cooling_off" && !incomplete && codes.has("FAN_IN_UNCORROBORATED")) focus = "collection";
  return { groups, focus, incomplete, mlAvailable };
}

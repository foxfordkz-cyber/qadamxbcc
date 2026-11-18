import type { Answers, Evaluation } from "./contracts";
import { completeCoolingAnswers, coolingQuestions } from "./cooling-flow";

/** Recovery may update its own receipt, but cannot steal an explicitly selected case. */
export function shouldRestoreAttempt(incomingId: string, attemptId: string | null, selectedId: string | null) {
  return incomingId === attemptId && (selectedId === null || selectedId === incomingId);
}

/** Only unsent answers belong in this cache. An authoritative matching save consumes them. */
export function reconcileCoolingDrafts(drafts: Record<string, Partial<Answers>>, evaluation: Pick<Evaluation, "transaction_id" | "status" | "verification_answers">) {
  const draft = drafts[evaluation.transaction_id];
  if (!draft) return drafts;
  const saved = completeCoolingAnswers(draft) && coolingQuestions.every(key => draft[key] === evaluation.verification_answers?.[key]);
  if (evaluation.status === "cooling_off" && !saved) return drafts;
  const next = { ...drafts }; delete next[evaluation.transaction_id]; return next;
}

import type { Answers } from "./contracts";

export const coolingQuestions: (keyof Answers)[] = [
  "caller_claims_bank_or_police", "asked_to_move_to_safe_account",
  "asked_to_keep_secret_or_install_app", "initiated_by_customer", "knows_recipient_personally",
];

export function remainingSeconds(until: string | null, now: number): number | null {
  const deadline = until ? Date.parse(until) : NaN;
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}

export function completeAnswers(answers: Partial<Answers>): answers is Answers {
  return coolingQuestions.every(question => typeof answers[question] === "boolean");
}

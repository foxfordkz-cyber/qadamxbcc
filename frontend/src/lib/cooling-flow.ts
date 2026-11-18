import type { Answers } from "./contracts";

export const coolingQuestions: (keyof Answers)[] = ["caller_claims_bank_or_police", "asked_to_move_to_safe_account", "asked_to_keep_secret_or_install_app", "initiated_by_customer", "knows_recipient_personally"];
export function completeCoolingAnswers(answers: Partial<Answers>): answers is Answers {
  return coolingQuestions.every(key => typeof answers[key] === "boolean");
}
export function firstCoolingStep(answers: Partial<Answers>) {
  const first = coolingQuestions.findIndex(key => typeof answers[key] !== "boolean");
  return first < 0 ? coolingQuestions.length : first === 0 ? -1 : first;
}
export function retainCoolingDraft(drafts: Record<string, Partial<Answers>>, id: string, answers: Partial<Answers>, limit = 250) {
  const previous = Object.entries(drafts).filter(([key]) => key !== id);
  const bounded = Object.fromEntries(previous.slice(Math.max(0, previous.length - Math.max(0, limit - 1))));
  return { ...bounded, [id]: Object.fromEntries(coolingQuestions.filter(key => typeof answers[key] === "boolean").map(key => [key, answers[key]])) };
}

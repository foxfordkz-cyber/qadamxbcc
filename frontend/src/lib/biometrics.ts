import type { Context, Reason } from "./contracts";

export type InputField = "recipient" | "amount";
export interface SensorSnapshot {
  pasted_recipient: boolean;
  typing_duration_ms: number | null;
  hesitation_count: number;
  recipient_input_length: number | null;
  hesitation_ms: number | null;
  edits: number;
}
const empty = (): SensorSnapshot => ({ pasted_recipient: false, typing_duration_ms: null, hesitation_count: 0, recipient_input_length: null, hesitation_ms: null, edits: 0 });

/** Measures events, never stores input contents, clipboard text, or keyboard codes. */
export class BiometricSensor {
  private value = empty();
  private last: Partial<Record<InputField, number>> = {};
  private lengths: Partial<Record<InputField, number>> = {};
  private amountEdited = false;
  private recipientCharacters = 0;
  reset(): SensorSnapshot { this.value = empty(); this.last = {}; this.lengths = {}; this.amountEdited = false; this.recipientCharacters = 0; return this.snapshot(); }
  focus(field: InputField, length: number) { this.lengths[field] = length; delete this.last[field]; }
  blur(field: InputField) { delete this.last[field]; }
  paste(field: InputField): SensorSnapshot {
    if (field === "recipient") this.value.pasted_recipient = true;
    return this.snapshot();
  }
  input(field: InputField, length: number, inputType: string, characters: number, now: number): SensorSnapshot {
    const previous = this.last[field];
    const gap = previous === undefined ? 0 : Math.max(0, now - previous);
    const deletion = inputType.startsWith("delete") || length < (this.lengths[field] ?? length);
    const pause = gap >= 1500;
    this.value.typing_duration_ms = Math.min(3_600_000, (this.value.typing_duration_ms ?? 0) + Math.round(gap));
    this.value.hesitation_ms = Math.min(300_000, (this.value.hesitation_ms ?? 0) + (pause ? Math.round(gap) : 0));
    this.value.hesitation_count = Math.min(100, this.value.hesitation_count + Number(pause) + Number(deletion));
    this.value.edits++;
    if (field === "recipient") {
      if (!deletion && inputType !== "insertFromPaste") {
        this.recipientCharacters += Math.max(0, characters || length - (this.lengths[field] ?? length));
      }
    } else { this.amountEdited = true; }
    this.last[field] = now; this.lengths[field] = length;
    // The backend character-count feature describes the recipient, not the amount.
    this.value.recipient_input_length = Math.min(128, this.recipientCharacters);
    return this.snapshot();
  }
  snapshot(): SensorSnapshot { return { ...this.value }; }
  context(): Pick<Context, "pasted_recipient" | "typing_duration_ms" | "hesitation_count" | "recipient_input_length" | "hesitation_ms"> {
    return { pasted_recipient: this.value.pasted_recipient,
      typing_duration_ms: this.value.typing_duration_ms,
      hesitation_count: this.value.hesitation_count,
      // Combined recipient + amount duration cannot accurately describe recipient
      // characters/sec. Leave that optional model feature unknown for mixed input.
      recipient_input_length: this.value.edits && !this.amountEdited ? Math.min(128, this.recipientCharacters) : null,
      hesitation_ms: this.value.hesitation_ms };
  }
}

export function warningKeys(context: Partial<Context>, reasons: Reason[]) {
  const codes = new Set(reasons.map(r => r.code));
  const call = context.active_call || codes.has("ACTIVE_CALL");
  const keys: ("warningSafeAccount" | "warningPaste" | "warningDevice" | "warningCall" | "warningGeneric")[] = [];
  if (call && (context.from_deposit || codes.has("DEPOSIT_WITHDRAWAL"))) keys.push("warningSafeAccount");
  if ((call && context.pasted_recipient) || codes.has("PASTED_DURING_CALL")) keys.push("warningPaste");
  if (context.is_new_device || codes.has("NEW_DEVICE")) keys.push("warningDevice");
  if (!keys.length && call) keys.push("warningCall");
  return keys.length ? keys : ["warningGeneric" as const];
}

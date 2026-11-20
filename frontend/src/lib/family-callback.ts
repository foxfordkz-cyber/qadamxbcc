export interface PhoneContactPicker {
  select(fields: ["tel"], options: { multiple: false }): Promise<{ tel?: string[] }[]>;
}

/** Read only the contact the customer chooses for this call. Never take the payment destination as a fallback. */
export async function pickCallbackNumbers(picker: PhoneContactPicker): Promise<string[]> {
  const [contact] = await picker.select(["tel"], { multiple: false });
  const numbers = new Set<string>();
  for (const raw of contact?.tel ?? []) {
    const compact = raw.trim().replace(/[ ()\u00a0-]/g, "");
    const number = /^[78]\d{10}$/.test(compact) ? "+7" + compact.slice(1) : compact;
    if (/^\+[1-9]\d{6,14}$/.test(number)) numbers.add(number);
  }
  return [...numbers];
}

import { z } from "zod";
import type { AppConfig } from "./contracts";

const ref = z.enum(["normal", "scam", "hub"]);
const bank = z.enum(["bcc", "other"]);
export const payeeInput = z.object({recipient: ref, bank, expected_name: z.string().max(80)}).strict();
export const payeeResult = z.object({
  recipient: ref, bank, source: z.literal("synthetic_directory"),
  status: z.enum(["identified", "match", "close", "mismatch", "unavailable"]),
  display_name: z.string().max(100).regex(/^[\p{L}\p{M}'’-]+ \p{L}\.$/u).nullable(),
}).strict().refine(value => (value.status === "unavailable") === (value.display_name === null));
export type PayeeInput = z.infer<typeof payeeInput>;
export type PayeeResult = z.infer<typeof payeeResult>;

// These are the three published seed beneficiaries. No lookup by arbitrary account detail.
const fixtures = {
  normal: { phone: "+77010000002", card: "4400000000000002", name: "Данияр А." },
  scam: { phone: "+77010000003", card: "4400000000000003", name: "Алексей К." },
  hub: { phone: "+77010000004", card: "4400000000000004", name: "Марат Т." },
} as const;

export function recipientRef(type: "phone" | "card" | "iban", detail: string) {
  if (type === "iban") return null;
  const normalized = detail.replace(/[\s()-]/g, "");
  return ref.options.find(key => fixtures[key][type] === normalized) ?? null;
}

export function fixtureContactName(config: Pick<AppConfig, "mode" | "accountMode">, type: "phone" | "card" | "iban", detail: string) {
  if (config.mode !== "demo" && config.accountMode !== "test") return null;
  const key = recipientRef(type, detail);
  return key ? fixtures[key].name : null;
}

const nameKey = (name: string) => name.normalize("NFC").toLowerCase().replace(/[.\s]+/g, " ").trim();

/** The browser-only static build and Next demo mode use published masked fixtures. */
export function demoPayee(input: PayeeInput): PayeeResult {
  const base = {recipient: input.recipient, bank: input.bank, source: "synthetic_directory" as const};
  if (input.bank !== "bcc") return {...base, status: "unavailable", display_name: null};
  const display = fixtures[input.recipient].name;
  const expected = nameKey(input.expected_name);
  const status = !input.expected_name.trim() ? "identified" : expected === nameKey(display) ? "match"
    : expected === nameKey(display).split(" ")[0] ? "close" : "mismatch";
  return {...base, status, display_name: display};
}

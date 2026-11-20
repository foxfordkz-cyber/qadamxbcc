import { z } from "zod";

export const returnAction = z.enum(["return_to_sender", "report_redirect", "appeal"]);
export const returnActionInput = z.object({ action: returnAction, confirmed: z.literal(true) }).strict();
export const reviewInput = z
  .object({
    decision: z.enum(["clear", "uphold"]),
    stage: z.enum(["reported", "appealed"]),
    confirmed: z.literal(true),
  })
  .strict();
const reviewState = z.enum(["none", "reported", "appealed", "cleared", "upheld"]);
export const paymentSchema = z
  .object({
    original_id: z.uuid(),
    received_at: z.iso.datetime({ offset: true }),
    amount: z
      .string()
      .regex(/^\d{1,10}(?:\.\d{1,2})?$/)
      .refine((v) => Number(v) > 0 && Number(v) <= 1_000_000_000),
    currency: z.literal("KZT"),
    payer: z.object({
      display_name: z.string().min(1).max(256),
      iban_masked: z.string().regex(/^KZ\*\* •••• [A-Z0-9]{4}$/),
    }),
    review_state: reviewState,
    can_appeal: z.boolean(),
    refund_transaction_id: z.uuid().nullable(),
    refund_status: z.enum(["approved", "cooling_off", "blocked", "cancelled"]).nullable(),
  })
  .refine(
    (v) =>
      (v.refund_status === null) === (v.refund_transaction_id === null) &&
      v.refund_transaction_id !== v.original_id,
  );
export const incomingSchema = z
  .object({ items: z.array(paymentSchema).max(25) })
  .refine((page) => new Set(page.items.map((item) => item.original_id)).size === page.items.length);
export type IncomingPayment = z.infer<typeof paymentSchema>;
export type ReturnAction = z.infer<typeof returnAction>;

export function returnRoute(path: string) {
  const parts = path.split("/");
  if (path === "returns/incoming") return { kind: "list" } as const;
  if (parts[0] === "returns" && parts.length === 2 && z.uuid().safeParse(parts[1]).success)
    return { kind: "payment", id: parts[1] } as const;
  if (
    parts.length === 4 &&
    parts[0] === "soc" &&
    parts[1] === "returns" &&
    parts[3] === "review" &&
    z.uuid().safeParse(parts[2]).success
  )
    return { kind: "review", id: parts[2] } as const;
  return undefined;
}

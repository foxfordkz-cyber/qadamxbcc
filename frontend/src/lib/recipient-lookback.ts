import { z } from "zod";

export const lookbackRoute = /^soc\/recipients\/[0-9a-f-]{36}\/prior-receipts$/i;
export const priorReceiptQuery = z.object({
  version: z.coerce.number().int().positive().safe(),
  days: z.coerce.number().int().min(1).max(30).default(7),
  cursor: z.uuid().optional(),
}).strict();
export type PriorReceiptQuery = z.infer<typeof priorReceiptQuery>;

export const priorReceipts = z.object({
  account_id: z.uuid(),
  flag_version: z.number().int().positive(),
  from_time: z.iso.datetime({ offset: true }),
  flagged_at: z.iso.datetime({ offset: true }),
  items: z.array(z.object({
    transaction_id: z.uuid(), sender_ref: z.string().regex(/^[0-9a-f]{8}$/),
    settled_at: z.iso.datetime({ offset: true }), amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    status: z.literal("approved"),
  })).max(20),
  next_cursor: z.uuid().nullable(),
});
export type PriorReceipts = z.infer<typeof priorReceipts>;

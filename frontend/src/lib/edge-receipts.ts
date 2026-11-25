import { z } from "zod";

export const edgeReceiptRoute = /^soc\/transfers\/[0-9a-f-]{36}\/edge-receipts$/i;
export const edgeQuery = z.object({ source: z.uuid(), target: z.uuid() }).strict()
  .refine(pair => pair.source.toLowerCase() !== pair.target.toLowerCase());
const instant = z.iso.datetime({ offset: true });
// The ledger records microseconds. Date.parse alone truncates two nearby settlements to the same millisecond.
const micros = (iso: string) => Date.parse(iso) * 1000
  + Number((iso.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6));
export const edgeReceiptSchema = z.object({
  transaction_id: z.uuid(), source: z.uuid(), target: z.uuid(),
  from_time: instant, before_time: instant, has_more: z.boolean(),
  items: z.array(z.object({
    transaction_id: z.uuid(), settled_at: instant, amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  })).max(12),
}).refine(page => micros(page.from_time) < micros(page.before_time)
  && new Set(page.items.map(row => row.transaction_id)).size === page.items.length
  && page.items.every(row => row.transaction_id !== page.transaction_id
    && micros(row.settled_at) >= micros(page.from_time)
    && micros(row.settled_at) < micros(page.before_time)));
export type EdgeReceipts = z.infer<typeof edgeReceiptSchema>;

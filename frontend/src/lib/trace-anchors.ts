import { z } from "zod";

export const anchorsRoute = /^soc\/accounts\/[0-9a-f-]{36}\/trace-anchors$/i;
export const traceAnchorsSchema = z.object({
  account_id: z.uuid(),
  items: z.array(z.object({
    transaction_id: z.uuid(),
    amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
    settled_at: z.iso.datetime({ offset: true }),
  })).max(8),
});
export type TraceAnchors = z.infer<typeof traceAnchorsSchema>;

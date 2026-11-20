import { z } from "zod";

export const traceRoute = /^soc\/transfers\/[0-9a-f-]{36}\/funds-trace$/i;
const amount = z.string().regex(/^\d+(?:\.\d{1,2})?$/);
const instant = z.iso.datetime({ offset: true });
const hop = z.number().int().min(1).max(3);

const link = z.object({
  transaction_id: z.uuid(), sender_id: z.uuid(), recipient_id: z.uuid(),
  settled_at: instant, transaction_amount: amount, allocated_amount: amount,
  first_hop: hop, last_hop: hop,
}).refine(row => row.first_hop <= row.last_hop && Number(row.allocated_amount) > 0
  && Number(row.allocated_amount) <= Number(row.transaction_amount));

export const fundsTraceSchema = z.object({
  transaction_id: z.uuid(), recipient_id: z.uuid(),
  status: z.enum(["approved", "cooling_off", "blocked", "cancelled"]),
  amount, currency: z.literal("KZT"), settled_at: instant.nullable(), observed_until: instant,
  outcome: z.enum(["not_settled", "no_match", "possible_flow", "insufficient_evidence"]),
  window_hours: z.literal(24), max_hops: z.literal(3), max_candidates: z.literal(160),
  candidates_examined: z.number().int().min(0).max(160), truncated: z.boolean(),
  ambiguous_count: z.number().int().min(0).max(160), first_hop_amount: amount,
  links: z.array(link).max(160),
}).refine(value => Number(value.first_hop_amount) <= Number(value.amount)
  && (value.status === "approved" ? value.settled_at !== null : value.outcome === "not_settled" && value.settled_at === null)
  && (value.links.length > 0) === (value.outcome === "possible_flow")
  && value.links.length <= value.candidates_examined);

export type FundsTrace = z.infer<typeof fundsTraceSchema>;

import { z } from "zod";

export const recipientFlagInputSchema = z.object({
  flagged: z.boolean(), note: z.string().trim().min(1).max(200).refine(value => !/\p{C}/u.test(value), "Use plain text without control characters"),
  request_id: z.uuid(), expected_version: z.number().int().nonnegative(),
}).strict();
export const recipientFlagSchema = z.object({
  account_id: z.uuid(), flagged: z.boolean(), version: z.number().int().nonnegative(),
  updated_at: z.iso.datetime({ offset: true }).nullable(),
});
export const recipientFlagReceiptSchema = recipientFlagSchema.extend({
  audit_id: z.uuid(), actor: z.string(), note: z.string().max(200), previous_flagged: z.boolean(),
});
export type RecipientFlagInput = z.infer<typeof recipientFlagInputSchema>;
export type RecipientFlag = z.infer<typeof recipientFlagSchema>;
export type RecipientFlagReceipt = z.infer<typeof recipientFlagReceiptSchema>;
export const FLAG_PENDING_PREFIX = "saqbol.recipient-flag.pending.";
const markerSchema = z.object({ account_id: z.uuid(), request_id: z.uuid() });
export function flagMarker(accountId: string, input: RecipientFlagInput): string {
  return JSON.stringify(markerSchema.parse({ account_id: accountId, request_id: input.request_id }));
}
export function readFlagMarker(accountId: string, raw: string | null) {
  try { const value = markerSchema.parse(JSON.parse(raw ?? "null")); return value.account_id === accountId ? value : null; } catch { return null; }
}

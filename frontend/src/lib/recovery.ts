import { z } from "zod";
import type { Evaluation, PresetForm } from "./contracts";

export const recoveryKey = "bcc-shield.recovery.v2";
const recordSchema = z.object({
  id: z.uuid(), state: z.enum(["unknown", "held", "resolved", "abandoned"]),
  status: z.enum(["approved", "cooling_off", "blocked", "cancelled"]).optional(),
  updatedAt: z.number().int().nonnegative(), draftKey: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type RecoveryRecord = z.infer<typeof recordSchema>;
type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = StorageReader & Pick<Storage, "setItem">;
const rank = { unknown: 0, held: 1, resolved: 2, abandoned: 2 };
export const unresolved = (record: RecoveryRecord) => record.state === "unknown" || record.state === "held";

/** Terminal receipts win over a stale browser's earlier hold; unresolved IDs are never silently evicted. */
export function mergeRecovery(...groups: readonly RecoveryRecord[][]): RecoveryRecord[] {
  const byId = new Map<string, RecoveryRecord>();
  for (const record of groups.flat()) {
    const previous = byId.get(record.id);
    const winner = !previous || rank[record.state] > rank[previous.state] || (rank[record.state] === rank[previous.state] && record.updatedAt >= previous.updatedAt) ? record : previous;
    const draftKey = winner.draftKey ?? previous?.draftKey ?? record.draftKey;
    byId.set(record.id, { ...winner, ...(draftKey ? { draftKey } : {}) });
  }
  const sorted = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  return [...sorted.filter(unresolved), ...sorted.filter(record => !unresolved(record)).slice(0, 250)];
}
export function readRecovery(storage?: StorageReader): RecoveryRecord[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(recoveryKey) ?? "[]");
    if (!Array.isArray(value)) return [];
    return mergeRecovery(value.flatMap(item => { const parsed = recordSchema.safeParse(item); return parsed.success ? [parsed.data] : []; }));
  } catch { return []; }
}
export function saveRecovery(records: RecoveryRecord[], storage?: StorageWriter) {
  const merged = mergeRecovery(readRecovery(storage), records);
  try { if (!storage) return { records: merged, persisted: false }; storage.getItem(recoveryKey); storage.setItem(recoveryKey, JSON.stringify(merged)); return { records: merged, persisted: true }; }
  catch { return { records: merged, persisted: false }; }
}
export function persistLegacyRecovery(records: RecoveryRecord[], storage: StorageWriter | undefined, legacy: Pick<Storage, "removeItem">) {
  const result = saveRecovery(records, storage);
  if (result.persisted) { try { legacy.removeItem("bcc-shield.pending.v1"); } catch { /* Keeping both copies is safe; IDs merge without duplication. */ } }
  return result;
}
export function receipt(value: Evaluation, previous?: RecoveryRecord): RecoveryRecord {
  return { id: value.transaction_id, state: value.status === "cooling_off" ? "held" : "resolved", status: value.status, updatedAt: Date.now(), ...(previous?.draftKey ? { draftKey: previous.draftKey } : {}) };
}
/** Kept only in memory. Storage receives a SHA-256 digest, never recipient, amount or biometric contents. */
export function draftIdentity(form: PresetForm, type: "phone" | "card" | "iban") {
  return JSON.stringify([form.sender.trim().toLowerCase(), type, form.recipient.replace(/[\s()-]/g, "").toUpperCase(), Number(form.amount).toFixed(2), form.context.active_call, form.context.from_deposit, form.context.is_new_device]);
}
export async function digestDraft(identity: string): Promise<string> {
  if (!crypto.subtle) throw new Error("recoveryUnavailable");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function findDraftReceipt(records: RecoveryRecord[], draftKey: string) {
  return records.filter(record => record.draftKey === draftKey && record.state !== "abandoned").sort((a, b) => b.updatedAt - a.updatedAt)[0];
}
export function recoveryBatch(records: RecoveryRecord[], cursor: number, currentId: string | null, limit = 4) {
  const current = records.find(record => record.id === currentId && record.state !== "abandoned");
  const pending = records.filter(record => unresolved(record) && record.id !== currentId).sort((a, b) => a.id.localeCompare(b.id));
  const count = Math.min(pending.length, Math.max(0, limit - Number(!!current)));
  const batch = Array.from({ length: count }, (_, offset) => pending[(cursor + offset) % pending.length]);
  return { records: current ? [current, ...batch] : batch, nextCursor: pending.length ? (cursor + count) % pending.length : 0 };
}
export function acceptsEvaluation(incoming: Evaluation, stored?: RecoveryRecord, previous?: Evaluation) {
  if (stored?.state === "abandoned") return false;
  if (stored?.state === "resolved" && incoming.status !== stored.status) return false;
  if (previous && previous.status !== "cooling_off" && incoming.status !== previous.status) return false;
  if (previous?.server_time && incoming.server_time && Date.parse(incoming.server_time) < Date.parse(previous.server_time)) return false;
  return true;
}

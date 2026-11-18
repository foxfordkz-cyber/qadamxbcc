import { z } from "zod";
import { api, ApiError, type Evaluation, type TransferInput } from "./contracts";
import { randomId } from "./secure-fallback";

const key = "bcc-shield.pending.v1";
const idsSchema = z.array(z.uuid()).max(250);
export function readPending(storage?: Pick<Storage, "getItem">): string[] {
  try { return idsSchema.parse(JSON.parse(storage?.getItem(key) ?? "[]")); } catch { return []; }
}
export function writePending(ids: string[], storage?: Pick<Storage, "setItem">) {
  try { storage?.setItem(key, JSON.stringify([...new Set(ids)].slice(-250))); } catch { /* Storage can be disabled; the SOC remains authoritative. */ }
}
export const isUnknownOutcome = (error: unknown) => !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || error.status === 408 || error.status === 429;

/** Keep the same payload/UUID when a response is lost; never silently create a second transfer. */
export class TransferAttempt {
  readonly input: TransferInput;
  constructor(input: TransferInput, requestId = randomId()) { this.input = { ...input, request_id: input.request_id ?? requestId }; }
  async execute(): Promise<Evaluation> {
    const original = await api<Evaluation>("transfers/evaluate", { method: "POST", body: JSON.stringify(this.input) });
    // Idempotency replays the original evaluation; the transfer may already be resolved elsewhere.
    try { return await api<Evaluation>(`transfers/${original.transaction_id}`); } catch { return original; }
  }
}

export function remainingSeconds(result: Pick<Evaluation, "cooling_off_until" | "server_time">, elapsedMs: number, receivedAt: number) {
  const server = result.server_time ? Date.parse(result.server_time) : receivedAt;
  const deadline = result.cooling_off_until ? Date.parse(result.cooling_off_until) : server;
  return Math.max(0, Math.ceil((deadline - server - Math.max(0, elapsedMs)) / 1000));
}

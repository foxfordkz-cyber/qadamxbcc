import { z } from "zod";
import data from "./collection-checkpoints.json";

const snapshot = z.object({
  senders: z.number().int().nonnegative(),
  received: z.number().int().nonnegative(),
  forwarded: z.number().int().nonnegative(),
  score: z.number().int().min(0).max(100),
  decision: z.enum(["approved", "cooling_off", "blocked"]),
  signals: z.array(z.object({ code: z.string(), kk: z.string(), ru: z.string() })),
});

const timestamp = z.iso.datetime({ offset: true });
const posting = z.object({
  tx_id: z.string().min(1),
  occurred_at: timestamp,
  sender: z.string().min(1),
  recipient: z.string().min(1),
  amount: z.number().int().positive(),
});

export const collectionReplay = z.object({
  model: z.string(),
  payment: z.number().positive(),
  checkpoints: z.array(z.object({ time: z.string(), evaluated_at: timestamp, a: snapshot, b: snapshot })).min(2),
  ledger: z.object({ a: z.array(posting), b: z.array(posting) }),
}).parse(data);

export const accounts = ["a", "b"] as const;
export type ReplayAccount = typeof accounts[number];
export type ReplaySnapshot = z.infer<typeof snapshot>;
export type ReplayPosting = z.infer<typeof posting>;

// Only the historical signals below can be traced to individual postings in this replay.
// In particular, the ML score describes the combination of features at the checkpoint.
const evidenceScope = new Map<string, { incomingOnly?: boolean; minutes?: number }>([
  ["FAN_IN_VELOCITY", { incomingOnly: true, minutes: 60 }],
  ["DROP_HUB_FAN_IN", { incomingOnly: true, minutes: 30 }],
  ["RECIPIENT_MANY_SENDERS", { incomingOnly: true }],
  ["RECIPIENT_INSTANT_CASHOUT", { minutes: 60 }],
  ["RECIPIENT_TRANSIT_RATIO", {}],
  ["FAN_IN_UNCORROBORATED", {}],
]);

export function replayPostings(account: ReplayAccount, evaluatedAt: string, signal?: string) {
  const scope = signal === undefined ? {} : evidenceScope.get(signal);
  if (!scope) return null;
  const end = Date.parse(evaluatedAt);
  const start = scope.minutes ? end - scope.minutes * 60_000 : -Infinity;
  return collectionReplay.ledger[account].filter(entry => {
    const time = Date.parse(entry.occurred_at);
    return time > start && time <= end && (!scope.incomingOnly || entry.recipient === "recipient");
  }).reverse();
}

export function readReplaySelection(value: string | null) {
  const match = /^([ab])-([1-9]\d?)$/.exec(value ?? "");
  if (!match) return null;
  const account: ReplayAccount = match[1] === "a" ? "a" : "b";
  const index = Number(match[2]) - 1;
  const checkpoint = collectionReplay.checkpoints[index];
  return checkpoint ? { account, index, checkpoint } : null;
}

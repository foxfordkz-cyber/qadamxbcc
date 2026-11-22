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

export const collectionReplay = z.object({
  model: z.string(),
  payment: z.number().positive(),
  checkpoints: z.array(z.object({ time: z.string(), a: snapshot, b: snapshot })).min(2),
}).parse(data);

export const accounts = ["a", "b"] as const;
export type ReplayAccount = typeof accounts[number];
export type ReplaySnapshot = z.infer<typeof snapshot>;

export function readReplaySelection(value: string | null) {
  const match = /^([ab])-([1-9]\d?)$/.exec(value ?? "");
  if (!match) return null;
  const account: ReplayAccount = match[1] === "a" ? "a" : "b";
  const index = Number(match[2]) - 1;
  const checkpoint = collectionReplay.checkpoints[index];
  return checkpoint ? { account, index, checkpoint } : null;
}

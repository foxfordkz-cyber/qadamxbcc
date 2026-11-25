type Outcome = { fraud: boolean; score: number; decision: string; amount_tiyn: number };

export function estimatePolicy(rows: readonly Outcome[], extraHoldAt: number | null) {
  let missed = 0, honestHeld = 0, missedTiyn = 0, honestHeldTiyn = 0;
  for (const row of rows) {
    const held = row.decision !== "approved" || (extraHoldAt !== null && row.score >= extraHoldAt);
    if (row.fraud && !held) {
      missed++;
      missedTiyn += row.amount_tiyn;
    } else if (!row.fraud && held) {
      honestHeld++;
      honestHeldTiyn += row.amount_tiyn;
    }
  }
  return { missed, honestHeld, missedTiyn, honestHeldTiyn };
}

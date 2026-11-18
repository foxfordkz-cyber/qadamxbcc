/** Scenario arithmetic only: these inputs are assumptions, not BCC measurements. */
export type PilotAssumptions = {
  transfers: number; fraudRatePct: number; baselineCapturePct: number;
  additionalCapturePct: number; averageLoss: number; extraHoldPct: number;
  reviewCost: number; annualCost: number;
};
export const pilotDefaults: PilotAssumptions = { transfers: 1_000_000, fraudRatePct: 0.05, baselineCapturePct: 40, additionalCapturePct: 20, averageLoss: 150_000, extraHoldPct: 0.1, reviewCost: 800, annualCost: 6_000_000 };
export const assumptionLimits: Record<keyof PilotAssumptions, number> = { transfers: 100_000_000, fraudRatePct: 100, baselineCapturePct: 100, additionalCapturePct: 100, averageLoss: 10_000_000, extraHoldPct: 100, reviewCost: 1_000_000, annualCost: 1_000_000_000 };
export function pilotEconomics(input: PilotAssumptions) {
  for (const key of Object.keys(assumptionLimits) as (keyof PilotAssumptions)[]) {
    if (!Number.isFinite(input[key]) || input[key] < 0 || input[key] > assumptionLimits[key]) throw new RangeError(`Invalid assumption: ${key}`);
  }
  const fraudulent = input.transfers * input.fraudRatePct / 100;
  const baselineMisses = fraudulent * (1 - input.baselineCapturePct / 100);
  const additionalCases = baselineMisses * input.additionalCapturePct / 100;
  const gross = additionalCases * input.averageLoss;
  const extraReviews = (input.transfers - fraudulent) * input.extraHoldPct / 100;
  const reviewExpense = extraReviews * input.reviewCost;
  const cost = reviewExpense + input.annualCost;
  return { fraudulent, baselineMisses, additionalCases, gross, extraReviews, reviewExpense, cost, net: gross - cost, roiPct: cost > 0 ? (gross - cost) / cost * 100 : null };
}

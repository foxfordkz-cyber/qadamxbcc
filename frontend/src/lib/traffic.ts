import { transferSchema, type City, type Evaluation, type FeedItem, type Preset, type PresetForm, type TrafficAccount } from "./contracts";

export interface TrafficRecord {
  evaluation: Evaluation;
  amount: string;
  from: City;
  to: City;
}
export function reconcileTraffic(records: Record<string, TrafficRecord>, items: FeedItem[]) {
  let updated = records;
  for (const item of items) {
    const record = records[item.transaction_id];
    if (record && record.evaluation.status !== item.status) {
      if (updated === records) updated = { ...records };
      updated[item.transaction_id] = { ...record, evaluation: { ...record.evaluation, status: item.status, risk_score: item.risk_score } };
    }
  }
  return updated;
}
export function trafficScenario(accounts: TrafficAccount[], sequence: number, presets?: Record<Preset, PresetForm>) {
  const safe = accounts.filter(a => a.role === "normal");
  const pattern = sequence % 6;
  const role = pattern === 2 ? "scam" : pattern === 4 ? "hub" : "normal";
  if (safe.length < 2) {
    // Custom live deployments already configure valid sender UUIDs and recipient
    // phones for the three presets. Reuse them without inventing account IDs.
    if (!presets) return null;
    const sender = presets[sequence % 2 ? "scam" : "normal"].sender;
    const input = transferSchema.safeParse({ sender_id: sender, recipient_phone: presets[role].recipient,
      amount: String(role === "scam" ? 480000 + (sequence % 5) * 25000 : role === "hub" ? 250000 : [3500, 12500, 27000, 8900][sequence % 4]),
      context: { active_call: role === "scam", from_deposit: role === "scam", is_new_device: false,
        pasted_recipient: role === "scam", hesitation_count: role === "scam" ? 4 : 0 },
    });
    return input.success ? { from: (sequence % 2 ? "almaty" : "astana") as City,
      to: (role === "scam" ? "shymkent" : role === "hub" ? "atyrau" : sequence % 2 ? "astana" : "almaty") as City,
      input: input.data } : null;
  }
  const sender = safe[sequence % safe.length];
  const recipient = role === "normal" ? safe.find(a => a.id !== sender.id) : accounts.find(a => a.role === role);
  if (!recipient) return null;
  const amount = role === "scam" ? 480000 + (sequence % 5) * 25000 : role === "hub" ? 250000 + (sequence % 4) * 10000 : [3500, 12500, 27000, 8900][sequence % 4];
  return { from: sender.city, to: recipient.city, input: transferSchema.parse({
    sender_id: sender.id, recipient_id: recipient.id, amount: String(amount), context: {
      active_call: role === "scam", from_deposit: role === "scam", is_new_device: false,
      // Simulator signals are explicit synthetic context, separate from the browser sensor.
      pasted_recipient: role === "scam", typing_duration_ms: role === "scam" ? 14000 : 2500,
      recipient_input_length: role === "scam" ? 3 : 12,
      hesitation_count: role === "scam" ? 4 : 0, hesitation_ms: role === "scam" ? 8000 : 0,
    },
  }) };
}
/** Reconcile status updates without double counting polling results or held money. */
export function preventedLoss(records: Record<string, TrafficRecord>, items: FeedItem[]): number {
  const statuses = new Map(items.map(item => [item.transaction_id, item.status]));
  return Object.entries(records).reduce((sum, [id, record]) => {
    const status = statuses.get(id) ?? record.evaluation.status;
    return sum + (status === "blocked" ? Math.round(Number(record.amount) * 100) : 0);
  }, 0) / 100;
}

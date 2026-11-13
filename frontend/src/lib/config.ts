import { z } from "zod";
import type { AppConfig, Preset, PresetForm, TrafficAccount } from "./contracts";

export const ids = {
  sender: "00000000-0000-4000-8000-000000000001",
  friend: "00000000-0000-4000-8000-000000000002",
  stranger: "00000000-0000-4000-8000-000000000003",
  hub: "00000000-0000-4000-8000-000000000004",
};
export const demoPresets: Record<Preset, PresetForm> = {
  normal: { sender: ids.sender, recipient: "+77010000002", amount: "25000", context: { active_call: false, from_deposit: false, is_new_device: false, is_new_recipient: false } },
  scam: { sender: ids.sender, recipient: "+77010000003", amount: "900000", context: { active_call: true, from_deposit: true, is_new_device: false, is_new_recipient: true } },
  hub: { sender: ids.sender, recipient: "+77010000004", amount: "250000", context: { active_call: false, from_deposit: false, is_new_device: false, is_new_recipient: true } },
};
export const demoTrafficAccounts: TrafficAccount[] = [
  { id: ids.sender, city: "astana", role: "normal" },
  { id: ids.friend, city: "almaty", role: "normal" },
  { id: ids.stranger, city: "shymkent", role: "scam" },
  { id: ids.hub, city: "atyrau", role: "hub" },
];
const trafficAccountsSchema = z.array(z.object({ id: z.uuid(), city: z.enum(["astana", "almaty", "shymkent", "atyrau"]), role: z.enum(["normal", "scam", "hub"]) }).strict()).max(20).refine(accounts => new Set(accounts.map(a => a.id)).size === accounts.length);
export function appConfig(): AppConfig {
  const mode = process.env.BCC_API_MODE === "live" ? "live" : "demo";
  if (mode === "demo") return { mode, presets: demoPresets, trafficAccounts: demoTrafficAccounts };
  const names = { normal: "NORMAL", scam: "SCAM", hub: "HUB" } as const;
  const presets = { ...demoPresets };
  for (const key of Object.keys(names) as Preset[]) {
    presets[key] = { ...demoPresets[key], sender: process.env[`BCC_${names[key]}_SENDER_ID`] ?? "", recipient: process.env[`BCC_${names[key]}_RECIPIENT_PHONE`] ?? "" };
  }
  // Only explicit simulator fixtures may generate traffic; arbitrary live presets
  // don't imply that four default UUIDs exist in that backend.
  const seeded = (Object.keys(presets) as Preset[]).every(key => presets[key].sender === demoPresets[key].sender && presets[key].recipient === demoPresets[key].recipient);
  let trafficAccounts: TrafficAccount[] = seeded ? demoTrafficAccounts : [];
  if (process.env.BCC_TRAFFIC_ACCOUNTS) {
    try { trafficAccounts = trafficAccountsSchema.parse(JSON.parse(process.env.BCC_TRAFFIC_ACCOUNTS)); }
    catch { trafficAccounts = []; }
  }
  return { mode, presets, trafficAccounts };
}

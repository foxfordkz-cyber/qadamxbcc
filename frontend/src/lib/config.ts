import type { AppConfig, Preset, PresetForm } from "./contracts";

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
export function appConfig(): AppConfig {
  const mode = process.env.BCC_API_MODE === "live" ? "live" : "demo";
  if (mode === "demo") return { mode, presets: demoPresets };
  const names = { normal: "NORMAL", scam: "SCAM", hub: "HUB" } as const;
  const presets = { ...demoPresets };
  for (const key of Object.keys(names) as Preset[]) {
    presets[key] = { ...demoPresets[key], sender: process.env[`BCC_${names[key]}_SENDER_ID`] ?? "", recipient: process.env[`BCC_${names[key]}_RECIPIENT_PHONE`] ?? "" };
  }
  return { mode, presets };
}

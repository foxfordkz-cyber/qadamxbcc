import { z } from "zod";

export const SOC_SESSION_KEY = "saq-bol.soc-workspace.v1";
const schema = z.object({
  mode: z.enum(["transfers", "cases"]).default("transfers"),
  selectedId: z.uuid().nullable().default(null),
  filter: z.enum(["all", "approved", "cooling_off", "blocked", "cancelled"]).default("all"),
  graphDepth: z.union([z.literal(1), z.literal(2)]).default(1),
});
export type SocDashboardSession = z.infer<typeof schema>;
export function readSocDashboardSession(raw: string | null): SocDashboardSession {
  try { return schema.parse(JSON.parse(raw ?? "{}")); } catch { return schema.parse({}); }
}
// Names, search text, financial details and credentials are deliberately not retained.
export function writeSocDashboardSession(value: SocDashboardSession): string { return JSON.stringify(schema.parse(value)); }

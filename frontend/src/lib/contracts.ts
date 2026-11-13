import { z } from "zod";

export type Lang = "kk" | "ru";
export type Status = "approved" | "cooling_off" | "blocked";
export type Preset = "normal" | "scam" | "hub";
export const contextSchema = z.object({
  active_call: z.boolean().default(false),
  from_deposit: z.boolean().default(false),
  is_new_device: z.boolean().default(false),
  is_new_recipient: z.boolean().optional(),
}).strict();
export const transferSchema = z.object({
  sender_id: z.uuid(),
  recipient_id: z.uuid().optional(),
  recipient_phone: z.string().regex(/^\+7\d{10}$/).optional(),
  recipient_iban: z.string().regex(/^KZ[0-9A-Z]{18}$/).optional(),
  recipient_card: z.string().regex(/^\d{16}$/).optional(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).refine(v => Number(v) > 0 && Number(v) <= 1_000_000_000),
  currency: z.literal("KZT").default("KZT"),
  context: contextSchema,
}).strict().refine(v => [v.recipient_id, v.recipient_phone, v.recipient_iban, v.recipient_card].filter(Boolean).length === 1);
export const answersSchema = z.object({
  caller_claims_bank_or_police: z.boolean(),
  asked_to_move_to_safe_account: z.boolean(),
  asked_to_keep_secret_or_install_app: z.boolean(),
  initiated_by_customer: z.boolean(),
  knows_recipient_personally: z.boolean(),
}).strict();
export type Answers = z.infer<typeof answersSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type Context = z.infer<typeof contextSchema>;
export interface Reason { code: string; layer: string; score_delta: number; reason_kk: string; reason_ru: string }
export interface Decision {
  transaction_id: string; status: Status; risk_score: number;
  headline_kk: string; headline_ru: string; reasons_kk: string[]; reasons_ru: string[];
}
export interface Evaluation extends Decision {
  reasons: Reason[]; latency_ms: number; layer_latency_ms: Record<string, number>;
  cooling_off_until: string | null; is_new_recipient: boolean; is_new_device: boolean;
  recipient: { id: string; display_name: string; iban_masked: string };
}
export interface Party { id: string; full_name: string; iban: string }
export interface FeedItem {
  transaction_id: string; created_at: string; status: Status; risk_score: number;
  amount: string | number; currency: string; latency_ms: number; sender: Party; recipient: Party;
  active_call: boolean; from_deposit: boolean; is_new_device: boolean; is_new_recipient: boolean;
  cooling_until: string | null; resolved_at: string | null; reasons: Reason[];
}
export interface Feed {
  server_time: string; items: FeedItem[];
  stats: { total: number; approved: number; cooling_off: number; blocked: number; avg_latency_ms: number; max_latency_ms: number };
}
export interface GraphData extends Record<string, unknown> {
  label: string; role: "center" | "hub" | "mule" | "normal"; depth: number; device_id: string;
  flagged: boolean; suspected_mule: boolean; in_degree: number; out_degree: number;
  in_weight: number; out_weight: number; transit_ratio: number; shared_device_accounts: number;
}
export interface Graph {
  center: string; depth: number;
  nodes: { id: string; type: string; position: { x: number; y: number }; data: GraphData }[];
  edges: { id: string; source: string; target: string; type: string; animated: boolean; label: string | null;
    data: { edge_type: "transfer" | "shared_device"; weight: number; tx_count: number; highlight: boolean } }[];
}
export interface PresetForm { sender: string; recipient: string; amount: string; context: Context }
export interface AppConfig { mode: "demo" | "live"; presets: Record<Preset, PresetForm> }

export class ApiError extends Error {
  constructor(public code: string) { super(code); }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(12_000),
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const code = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error : response.status === 404 ? "notFound" : response.status === 409 ? "conflict" : "apiError";
    throw new ApiError(code);
  }
  return response.json() as Promise<T>;
}

import { z } from "zod";

export type Lang = "kk" | "ru";
export type Status = "approved" | "cooling_off" | "blocked" | "cancelled";
export type Preset = "normal" | "scam" | "hub";
export const contextSchema = z.object({
  active_call: z.boolean().default(false),
  from_deposit: z.boolean().default(false),
  is_new_device: z.boolean().default(false),
  is_new_recipient: z.boolean().optional(),
  pasted_recipient: z.boolean().optional(),
  typing_duration_ms: z.number().int().min(0).max(3_600_000).nullable().optional(),
  hesitation_count: z.number().int().min(0).max(100).optional(),
  recipient_input_length: z.number().int().min(0).max(128).nullable().optional(),
  hesitation_ms: z.number().int().min(0).max(300_000).nullable().optional(),
}).strict();
export const transferSchema = z.object({
  request_id: z.uuid().optional(),
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
export interface MLDetails {
  ml_score?: number | null;
  ml_base_score?: number | null;
  ml_model_version?: string | null;
  ml_explanation_method?: string | null;
  ml_contributors?: { feature: string; value: number; contribution: number; label_kk: string; label_ru: string }[];
}
export interface Evaluation extends Decision, MLDetails {
  reasons: Reason[]; latency_ms: number; layer_latency_ms: Record<string, number>;
  cooling_off_until: string | null; is_new_recipient: boolean; is_new_device: boolean;
  recipient: { id: string; display_name: string; iban_masked: string };
  amount?: string;
  context?: Partial<Context>;
  server_time?: string;
  verification_answers?: Answers | null;
  resolved_at?: string | null;
  red_flags?: string[];
}
export interface AbandonResult { request_id: string; status: "abandoned" | "processed"; evaluation?: Evaluation | null; server_time: string }
export interface Party { id: string; full_name: string; iban: string }
export interface FeedItem extends MLDetails {
  transaction_id: string; created_at: string; status: Status; risk_score: number;
  amount: string | number; currency: string; latency_ms: number; sender: Party; recipient: Party;
  active_call: boolean; from_deposit: boolean; is_new_device: boolean; is_new_recipient: boolean;
  cooling_until: string | null; resolved_at: string | null; reasons: Reason[];
  context?: Partial<Context>;
  verification_answers?: Answers | null;
}
export interface Feed {
  server_time: string; items: FeedItem[];
  stats: { total: number; approved: number; cooling_off: number; blocked: number; cancelled?: number; blocked_amount?: string; held_amount?: string; cancelled_amount?: string; avg_latency_ms: number; max_latency_ms: number };
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
export type City = "astana" | "almaty" | "shymkent" | "atyrau";
export interface TrafficAccount { id: string; city: City; role: "normal" | "scam" | "hub" }
export interface AppConfig { mode: "demo" | "live"; presets: Record<Preset, PresetForm>; trafficAccounts?: TrafficAccount[]; demoActionsEnabled?: boolean }

export class ApiError extends Error {
  constructor(public code: string, public status = 0) { super(code); }
}
const statusSchema = z.enum(["approved", "cooling_off", "blocked", "cancelled"]);
const riskReasonSchema = z.object({ code: z.string(), layer: z.string(), score_delta: z.number(), reason_kk: z.string(), reason_ru: z.string() }).passthrough();
const mlResponseSchema = z.object({
  ml_score: z.number().min(0).max(100).nullable().optional(), ml_base_score: z.number().nullable().optional(), ml_model_version: z.string().nullable().optional(), ml_explanation_method: z.string().nullable().optional(),
  ml_contributors: z.array(z.object({ feature: z.string(), value: z.number(), contribution: z.number(), label_kk: z.string(), label_ru: z.string() })).optional(),
});
export const evaluationResponseSchema = mlResponseSchema.extend({
  transaction_id: z.uuid(), status: statusSchema, risk_score: z.number().min(0).max(100),
  headline_kk: z.string(), headline_ru: z.string(), reasons_kk: z.array(z.string()), reasons_ru: z.array(z.string()), reasons: z.array(riskReasonSchema),
  latency_ms: z.number().nonnegative(), layer_latency_ms: z.record(z.string(), z.number().nonnegative()),
  cooling_off_until: z.iso.datetime({ offset: true }).nullable(), is_new_recipient: z.boolean(), is_new_device: z.boolean(),
  recipient: z.object({ id: z.uuid(), display_name: z.string(), iban_masked: z.string() }),
  amount: z.string().optional(), server_time: z.iso.datetime({ offset: true }).optional(), verification_answers: answersSchema.nullable().optional(),
}).passthrough();
const abandonResponseSchema = z.object({ request_id: z.uuid(), status: z.enum(["abandoned", "processed"]), evaluation: evaluationResponseSchema.nullable().optional(), server_time: z.iso.datetime({ offset: true }) }).refine(value => value.status !== "processed" || !!value.evaluation);
const partySchema = z.object({ id: z.uuid(), full_name: z.string(), iban: z.string() });
const feedResponseSchema = z.object({ server_time: z.iso.datetime({ offset: true }), items: z.array(mlResponseSchema.extend({ transaction_id: z.uuid(), created_at: z.iso.datetime({ offset: true }), status: statusSchema, risk_score: z.number().min(0).max(100), amount: z.union([z.string(), z.number()]), currency: z.string(), latency_ms: z.number().nonnegative(), sender: partySchema, recipient: partySchema, reasons: z.array(riskReasonSchema) }).passthrough()), stats: z.object({ total: z.number().nonnegative(), approved: z.number().nonnegative(), cooling_off: z.number().nonnegative(), blocked: z.number().nonnegative(), avg_latency_ms: z.number().nonnegative(), max_latency_ms: z.number().nonnegative() }).passthrough() }).passthrough();
const graphResponseSchema = z.object({ center: z.string(), depth: z.number(), nodes: z.array(z.object({ id: z.string(), type: z.string(), position: z.object({ x: z.number(), y: z.number() }), data: z.object({ label: z.string(), role: z.enum(["center", "hub", "mule", "normal"]), depth: z.number(), device_id: z.string(), flagged: z.boolean(), suspected_mule: z.boolean(), in_degree: z.number(), out_degree: z.number(), in_weight: z.number(), out_weight: z.number(), transit_ratio: z.number(), shared_device_accounts: z.number() }).passthrough() })), edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), type: z.string(), animated: z.boolean(), label: z.string().nullable(), data: z.object({ edge_type: z.enum(["transfer", "shared_device"]), weight: z.number(), tx_count: z.number(), highlight: z.boolean() }) })) });
export function validateApiResponse(path: string, value: unknown) {
  const route = path.split("?")[0];
  const schema = /^transfers\/requests\/[0-9a-f-]+\/abandon$/i.test(route) ? abandonResponseSchema
    : route === "transfers/evaluate" || /^transfers\/[0-9a-f-]+(?:\/(?:resolve-cooling|cancel))?$/i.test(route) ? evaluationResponseSchema
    : route === "soc/feed" ? feedResponseSchema : route.startsWith("soc/graph/") ? graphResponseSchema : undefined;
  if (!schema) return value;
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError("invalidResponse", 502);
  return parsed.data;
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
    throw new ApiError(code, response.status);
  }
  try { return validateApiResponse(path, await response.json()) as T; }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError("invalidResponse", 502); }
}

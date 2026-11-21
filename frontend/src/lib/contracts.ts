import { z } from "zod";
import { payeeResult } from "./payee-check";
import { incomingSchema, paymentSchema, returnRoute } from "./payment-returns";
import { fundsTraceSchema, traceRoute } from "./funds-trace";
import { anchorsRoute, traceAnchorsSchema } from "./trace-anchors";
import { lookbackRoute, priorReceipts } from "./recipient-lookback";
import { validateSocIntegrationResponse } from "./soc-integrations";
import { recipientFlagReceiptSchema, recipientFlagSchema } from "./recipient-flag";

export type Lang = "kk" | "ru";
export type Status = "approved" | "cooling_off" | "blocked" | "cancelled";
export type Preset = "normal" | "scam" | "hub";
export const contextSchema = z.object({
  active_call: z.boolean().default(false),
  payment_requested_after_call: z.boolean().optional(),
  from_deposit: z.boolean().default(false),
  is_new_device: z.boolean().default(false),
  is_new_recipient: z.boolean().optional(),
  pasted_recipient: z.boolean().optional(),
  typing_duration_ms: z.number().int().min(0).max(3_600_000).nullable().optional(),
  hesitation_count: z.number().int().min(0).max(100).optional(),
  recipient_input_length: z.number().int().min(0).max(128).nullable().optional(),
  hesitation_ms: z.number().int().min(0).max(300_000).nullable().optional(),
  bank_call_check_id: z.uuid().optional(),
  /** Silent alarm («тихий код»): the client held the confirm button. */
  duress: z.boolean().optional(),
}).strict();
/** «Банк мне звонит?» — answered from the bank's outbound call log (simulated in the prototype). */
export const callCheckSchema = z.object({
  check_id: z.uuid(), verified: z.boolean(), employee_name: z.string().nullable().optional(), department: z.string().nullable().optional(),
  checked_at: z.iso.datetime({ offset: true }), started_at: z.iso.datetime({ offset: true }).nullish(),
  message_kk: z.string(), message_ru: z.string(), simulated_log: z.boolean().optional(),
}).passthrough();
export type CallCheck = z.infer<typeof callCheckSchema>;
export const bankCallSchema = z.object({ customer_id: z.uuid(), employee_name: z.string(), department: z.string(), expires_in_s: z.number().int().positive() }).passthrough();
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
export const postCallSchema = z.object({ action: z.enum(["ended", "recognized"]) }).strict();
export const cancelSchema = z.object({ reason: z.literal("post_call_scam").optional() }).strict();
export type TransferInput = z.infer<typeof transferSchema>;
export type Context = z.infer<typeof contextSchema>;
export interface Reason { code: string; layer: string; score_delta: number; reason_kk: string; reason_ru: string; evidence?: Record<string, unknown> }
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
  created_at?: string;
  updated_at?: string;
}
export interface AbandonResult { request_id: string; status: "abandoned" | "processed"; evaluation?: Evaluation | null; server_time: string }
export interface Party { id: string; full_name: string; iban: string }
export interface FeedItem extends MLDetails {
  transaction_id: string; created_at: string; status: Status; risk_score: number;
  updated_at?: string;
  amount: string | number; currency: string; latency_ms: number; sender: Party; recipient: Party;
  active_call: boolean; from_deposit: boolean; is_new_device: boolean; is_new_recipient: boolean;
  cooling_until: string | null; resolved_at: string | null; reasons: Reason[];
  context?: Partial<Context>;
  verification_answers?: Answers | null;
}
export interface Feed {
  server_time: string; items: FeedItem[];
  pagination: { total_filtered: number; offset: number; limit: number; has_more: boolean };
  stats: { submission_limits?: { active: number; rejected: number; limit: number; window_seconds: number; cooldown_seconds: number } | null; total: number; approved: number; cooling_off: number; blocked: number; blocked_hubs?: number; cancelled?: number; blocked_amount?: string; held_amount?: string; cancelled_amount?: string; avg_latency_ms: number; max_latency_ms: number; p95_latency_ms?: number | null; latency_sample_size?: number; latency_sample_limit?: number };
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
export interface AppConfig { privateStoryAccess?: boolean; accountMode?: "test" | "pilot"; publicSocReadOnly?: boolean; mode: "demo" | "live"; presets: Record<Preset, PresetForm>; trafficAccounts?: TrafficAccount[]; demoActionsEnabled?: boolean }

export class ApiError extends Error {
  constructor(public code: string, public status = 0, public retryAfter = 0) { super(code); }
}
const statusSchema = z.enum(["approved", "cooling_off", "blocked", "cancelled"]);
export const feedQuerySchema = z.object({
  alerts_only: z.union([z.boolean(), z.enum(["true", "false"]).transform(value => value === "true")]).default(false),
  status: statusSchema.optional(), q: z.string().max(128).refine(value => !value.includes("\u0000")).transform(value => value.trim()).default(""),
  min_score: z.coerce.number().int().min(0).max(100).default(0),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  since: z.iso.datetime({ offset: true }).optional(),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;
// Null means an unknown browser override, not false. UI consumers already use
// undefined for unknown optional context; normalize only that representation.
const responseContextSchema = contextSchema.partial().extend({
  bank_call_check_id: z.uuid().nullable().optional().transform(value => value ?? undefined),
  is_new_device: z.boolean().nullable().optional().transform(value => value ?? undefined),
  is_new_recipient: z.boolean().nullable().optional().transform(value => value ?? undefined),
});
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
  created_at: z.iso.datetime({ offset: true }).optional(), updated_at: z.iso.datetime({ offset: true }).optional(),
  resolved_at: z.iso.datetime({ offset: true }).nullable().optional(), context: responseContextSchema.optional(),
}).passthrough();
const abandonResponseSchema = z.object({ request_id: z.uuid(), status: z.enum(["abandoned", "processed"]), evaluation: evaluationResponseSchema.nullable().optional(), server_time: z.iso.datetime({ offset: true }) }).refine(value => value.status !== "processed" || !!value.evaluation);
const partySchema = z.object({ id: z.uuid(), full_name: z.string(), iban: z.string() });
const feedResponseSchema = z.object({
  server_time: z.iso.datetime({ offset: true }),
  items: z.array(mlResponseSchema.extend({
    transaction_id: z.uuid(), created_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }).optional(),
    status: statusSchema, risk_score: z.number().min(0).max(100), amount: z.union([z.string(), z.number()]),
    currency: z.string(), latency_ms: z.number().nonnegative(), sender: partySchema, recipient: partySchema,
    reasons: z.array(riskReasonSchema), context: responseContextSchema.optional(),
    verification_answers: answersSchema.nullable().optional(), resolved_at: z.iso.datetime({ offset: true }).nullable().optional(),
  }).passthrough()),
  pagination: z.object({ total_filtered: z.number().int().nonnegative(), offset: z.number().int().min(0).max(100_000), limit: z.number().int().min(1).max(200), has_more: z.boolean() }),
  stats: z.object({ submission_limits: z.object({ active: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), limit: z.number().int().positive(), window_seconds: z.number().int().positive(), cooldown_seconds: z.number().int().positive() }).nullish(), total: z.number().nonnegative(), approved: z.number().nonnegative(), cooling_off: z.number().nonnegative(), blocked: z.number().nonnegative(), blocked_hubs: z.number().int().nonnegative().optional(), avg_latency_ms: z.number().nonnegative(), max_latency_ms: z.number().nonnegative(), p95_latency_ms: z.number().nonnegative().nullable().optional(), latency_sample_size: z.number().int().min(0).max(500).optional(), latency_sample_limit: z.literal(500).optional() }).passthrough(),
}).passthrough();
const graphResponseSchema = z.object({ center: z.string(), depth: z.number(), nodes: z.array(z.object({ id: z.string(), type: z.string(), position: z.object({ x: z.number(), y: z.number() }), data: z.object({ label: z.string(), role: z.enum(["center", "hub", "mule", "normal"]), depth: z.number(), device_id: z.string(), flagged: z.boolean(), suspected_mule: z.boolean(), in_degree: z.number(), out_degree: z.number(), in_weight: z.number(), out_weight: z.number(), transit_ratio: z.number(), shared_device_accounts: z.number() }).passthrough() })), edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), type: z.string(), animated: z.boolean(), label: z.string().nullable(), data: z.object({ edge_type: z.enum(["transfer", "shared_device"]), weight: z.number(), tx_count: z.number(), highlight: z.boolean() }) })) });
export function validateApiResponse(path: string, value: unknown, method = "GET") {
  const route = path.split("?")[0];
  if (lookbackRoute.test(route)) {
    const parsed = priorReceipts.safeParse(value);
    const query = new URLSearchParams(path.split("?")[1]);
    if (!parsed.success || parsed.data.account_id.toLowerCase() !== route.split("/")[2].toLowerCase()
      || parsed.data.flag_version !== Number(query.get("version"))) throw new ApiError("invalidResponse", 502);
    return parsed.data;
  }
  if (anchorsRoute.test(route)) {
    const anchors = traceAnchorsSchema.safeParse(value);
    if (!anchors.success || anchors.data.account_id.toLowerCase() !== route.split("/")[2].toLowerCase()) throw new ApiError("invalidResponse", 502);
    return anchors.data;
  }
  const linked = returnRoute(route);
  if (linked) {
    if (linked.kind === "list") {
      const parsed = incomingSchema.safeParse(value);
      if (!parsed.success) throw new ApiError("invalidResponse", 502);
      return parsed.data;
    }
    const parsed = paymentSchema.safeParse(value);
    if (!parsed.success || parsed.data.original_id.toLowerCase() !== linked.id.toLowerCase()) throw new ApiError("invalidResponse", 502);
    return parsed.data;
  }
  if (traceRoute.test(route)) {
    const trace = fundsTraceSchema.safeParse(value);
    if (!trace.success || trace.data.transaction_id.toLowerCase() !== route.split("/")[2].toLowerCase()) throw new ApiError("invalidResponse", 502);
    return trace.data;
  }
  if (route.startsWith("integrations/")) {
    try { return validateSocIntegrationResponse(path, value, method.toUpperCase()); }
    catch { throw new ApiError("invalidResponse", 502); }
  }
  const schema = /^transfers\/requests\/[0-9a-f-]+\/abandon$/i.test(route) ? abandonResponseSchema
    : route === "transfers/evaluate" || /^transfers\/[0-9a-f-]+(?:\/(?:resolve-cooling|cancel|post-call))?$/i.test(route) ? evaluationResponseSchema
    : route === "payee-check" ? payeeResult : route === "call-check" ? callCheckSchema : route === "call-check/demo/bank-call" ? bankCallSchema
    : route === "soc/feed" ? feedResponseSchema : route.startsWith("soc/graph/") ? graphResponseSchema
    : /^soc\/recipients\/[0-9a-f-]{36}\/flag$/i.test(route) ? method.toUpperCase() === "POST" ? recipientFlagReceiptSchema : recipientFlagSchema : undefined;
  if (!schema) return value;
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError("invalidResponse", 502);
  if (/^soc\/recipients\/[0-9a-f-]{36}\/flag$/i.test(route) && (!("account_id" in parsed.data) || typeof parsed.data.account_id !== "string" || parsed.data.account_id.toLowerCase() !== route.split("/")[2].toLowerCase())) throw new ApiError("invalidResponse", 502);
  if (/^transfers\/[0-9a-f-]+(?:\/(?:cancel|post-call|resolve-cooling))?$/i.test(route) && (!("transaction_id" in parsed.data) || typeof parsed.data.transaction_id !== "string"
    || parsed.data.transaction_id.toLowerCase() !== route.split("/")[1].toLowerCase())) throw new ApiError("invalidResponse", 502);
  if (route.startsWith("soc/graph/") && (!("center" in parsed.data) || typeof parsed.data.center !== "string"
    || parsed.data.center.toLowerCase() !== route.split("/")[2].toLowerCase())) throw new ApiError("invalidResponse", 502);
  const requestedDepth = new URLSearchParams(path.split("?")[1]).get("depth");
  if (route.startsWith("soc/graph/") && requestedDepth !== null && (!("depth" in parsed.data)
    || parsed.data.depth !== Number(requestedDepth))) throw new ApiError("invalidResponse", 502);
  return parsed.data;
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const socIntegration = path.startsWith("integrations/");
  if (socIntegration && socRetryUntil > Date.now()) {
    throw new ApiError("rateLimited", 429, Math.ceil((socRetryUntil - Date.now()) / 1000));
  }
  // Static GitHub Pages build: no server, the demo engine runs in this browser.
  if (process.env.NEXT_PUBLIC_BCC_STATIC === "1") {
    const { staticApi } = await import("./static-api");
    try { return validateApiResponse(path, await staticApi(path, init), init?.method) as T; }
    catch (error) { if (error instanceof ApiError) throw error; throw new ApiError("invalidResponse", 502); }
  }
  const response = await fetch(`/api/v1/${path}`, {
    ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(12_000),
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const code = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error : response.status === 404 ? "notFound" : response.status === 409 ? "conflict" : "apiError";
    const wait = Number(response.headers.get("Retry-After"));
    const retryAfter = Number.isFinite(wait) && wait > 0 ? Math.min(3600, Math.ceil(wait)) : response.status === 429 ? 60 : 0;
    // All SOC widgets use one backend capability bucket. A case change or remount
    // must not bypass its deadline; never retry a mutation in the transport.
    if (socIntegration && response.status === 429) socRetryUntil = Math.max(socRetryUntil, Date.now() + retryAfter * 1000);
    throw new ApiError(code, response.status, retryAfter);
  }
  try { return validateApiResponse(path, await response.json(), init?.method) as T; }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError("invalidResponse", 502); }
}
let socRetryUntil = 0;

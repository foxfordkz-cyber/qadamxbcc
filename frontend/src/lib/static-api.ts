/**
 * Browser-only stand-in for the Next.js API routes, used by the static GitHub Pages
 * build (NEXT_PUBLIC_BCC_STATIC=1). It runs the same synthetic demo engine as the
 * server's demo mode and keeps its state in this browser's localStorage.
 * The live FastAPI backend, PostgreSQL and the ML model are not part of this build.
 */
import { z } from "zod";
import { traceRoute } from "./funds-trace";
import { anchorsRoute } from "./trace-anchors";
import { ApiError, answersSchema, cancelSchema, feedQuerySchema, postCallSchema, transferSchema } from "./contracts";
import { abandonDemo, bankCallDemo, callCheckDemo, cancelDemo, DemoError, detailDemo, evaluateDemo, feedDemo, graphDemo, postCallDemo, recipientFlagDemo, resolveDemo, setRecipientFlagDemo } from "./demo";
import { recipientFlagInputSchema } from "./recipient-flag";
import { ids } from "./demo-ids";
import { resetStaticCircle, staticCircle, staticContactSuspicion, staticGuide } from "./static-circle";

const STORE = "saqbol-static-demo-v1";
const keys = ["bccDemoTransfers", "bccDemoDetails", "bccDemoRequests", "bccDemoAbandoned", "bccDemoBankCalls", "bccDemoCallChecks", "bccDemoRecipientFlags", "bccDemoFlagReceipts"] as const;
type Root = Record<(typeof keys)[number], unknown>;
const root = globalThis as unknown as Partial<Root>;
// Re-read on every call: the main page and the /pitch iframe share one store, and a
// cached copy in one of them would overwrite transfers the other has just made.
// After a failed write the in-memory copy is newer than storage, so it is kept.
let unsaved = false;

function load() {
  if (unsaved) return;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as Record<string, unknown> | null;
    if (!saved) return;
    root.bccDemoTransfers = saved.bccDemoTransfers as unknown[];
    for (const key of ["bccDemoDetails", "bccDemoRequests", "bccDemoBankCalls", "bccDemoCallChecks", "bccDemoRecipientFlags", "bccDemoFlagReceipts"] as const) root[key] = new Map(saved[key] as [string, unknown][]);
    root.bccDemoAbandoned = new Set(saved.bccDemoAbandoned as string[]);
  } catch { /* Unreadable or blocked storage starts a fresh demo. */ }
}
function save() {
  try {
    const value: Record<string, unknown> = {};
    for (const key of keys) {
      const item = root[key];
      value[key] = item instanceof Map ? [...item.entries()] : item instanceof Set ? [...item] : item;
    }
    localStorage.setItem(STORE, JSON.stringify(value));
    unsaved = false;
  } catch { unsaved = true; /* A full or blocked storage keeps the in-memory demo working. */ }
}

const cards: Record<string, string> = { "4400000000000002": ids.friend, "4400000000000003": ids.stranger, "4400000000000004": ids.hub };
const uuid = (value: string | undefined) => z.uuid().parse(value);

function dispatch(method: string, route: string, search: URLSearchParams, body: unknown): unknown {
  const path = route.split("/");
  if (method === "GET" && (traceRoute.test(route) || anchorsRoute.test(route))) throw new ApiError("traceBackendRequired", 501);
  if (method === "POST" && route === "transfers/evaluate") {
    const { recipient_card, ...rest } = transferSchema.parse(body);
    if (recipient_card) {
      if (!cards[recipient_card]) throw new ApiError("cardUnsupported", 422);
      rest.recipient_id = cards[recipient_card];
    }
    return evaluateDemo(rest);
  }
  if (method === "POST" && /^transfers\/[0-9a-f-]{36}\/resolve-cooling$/i.test(route)) {
    const id = uuid(path[1]);
    return resolveDemo(id, z.object({ answers: answersSchema }).strict().parse(body).answers, Date.now(), staticContactSuspicion(id));
  }
  if (method === "POST" && /^transfers\/[0-9a-f-]{36}\/post-call$/i.test(route)) return postCallDemo(uuid(path[1]), postCallSchema.parse(body).action);
  if (method === "POST" && /^transfers\/[0-9a-f-]{36}\/cancel$/i.test(route)) return cancelDemo(uuid(path[1]), Date.now(), cancelSchema.parse(body ?? {}).reason === "post_call_scam");
  if (method === "POST" && /^transfers\/requests\/[0-9a-f-]{36}\/abandon$/i.test(route)) return abandonDemo(uuid(path[2]));
  if (method === "GET" && /^transfers\/[0-9a-f-]{36}$/i.test(route)) return detailDemo(uuid(path[1]));
  if (method === "GET" && route === "soc/feed") return feedDemo(feedQuerySchema.parse(Object.fromEntries(search)));
  if (/^soc\/recipients\/[0-9a-f-]{36}\/flag$/i.test(route)) {
    if (method === "GET") return recipientFlagDemo(uuid(path[2]));
    if (method === "POST") return setRecipientFlagDemo(uuid(path[2]), recipientFlagInputSchema.parse(body));
  }
  if (method === "GET" && /^soc\/graph\/[0-9a-f-]{36}$/i.test(route)) return graphDemo(uuid(path[2]), z.coerce.number().int().min(1).max(3).parse(search.get("depth") ?? 2));
  if (method === "POST" && (route === "call-check" || route === "call-check/demo/bank-call")) {
    const { customer_id } = z.object({ customer_id: z.uuid() }).strict().parse(body);
    return route === "call-check" ? callCheckDemo(customer_id) : bankCallDemo(customer_id);
  }
  if (method === "GET" && route === "scam-check/guide") return staticGuide;
  // Simulated in the browser: no Telegram here, the contact "replies" after a few seconds.
  if (route.startsWith("trusted-circle/")) return staticCircle(method, route, body);
  if (route.startsWith("integrations/")) throw new ApiError("integrationsUnavailable", 503);
  throw new ApiError("notFound", 404);
}

/** Clears this browser's demo: transfers, receipts and drafts. The page reloads afterwards. */
export function resetStaticDemo() {
  resetStaticCircle();
  for (const store of [localStorage, sessionStorage]) {
    try {
      for (const key of Object.keys(store)) if ((key.startsWith("bcc-shield.") && key !== "bcc-shield.locale") || key.startsWith("saqbol")
        || ["saq-bol.active-tab.v1", "saq-bol.soc-workspace.v1", "saq-bol-soc-cases-v1"].includes(key)) store.removeItem(key);
    } catch { /* Blocked storage holds nothing to clear. */ }
  }
  unsaved = false;
  for (const key of keys) delete root[key];
}

export async function staticApi(path: string, init?: RequestInit): Promise<unknown> {
  load();
  const [route, query = ""] = path.split("?");
  const method = (init?.method ?? "GET").toUpperCase();
  let body: unknown;
  try { body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined; } catch { throw new ApiError("invalid", 422); }
  try {
    const value = dispatch(method, route, new URLSearchParams(query), body);
    if (method !== "GET") save();
    return structuredClone(value);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DemoError) throw new ApiError(error.message, error.status);
    if (error instanceof z.ZodError) throw new ApiError("invalid", 422);
    throw new ApiError("apiError", 502);
  }
}

/**
 * Browser-only stand-in for the Next.js API routes, used by the static GitHub Pages
 * build (NEXT_PUBLIC_BCC_STATIC=1). It runs the same synthetic demo engine as the
 * server's demo mode and keeps its state in this browser's localStorage.
 * The live FastAPI backend, PostgreSQL and the ML model are not part of this build.
 */
import { z } from "zod";
import { ApiError, answersSchema, feedQuerySchema, transferSchema } from "./contracts";
import { abandonDemo, bankCallDemo, callCheckDemo, cancelDemo, DemoError, detailDemo, evaluateDemo, feedDemo, graphDemo, resolveDemo } from "./demo";
import { ids } from "./demo-ids";

const STORE = "saqbol-static-demo-v1";
const keys = ["bccDemoTransfers", "bccDemoDetails", "bccDemoRequests", "bccDemoAbandoned", "bccDemoBankCalls", "bccDemoCallChecks"] as const;
type Root = Record<(typeof keys)[number], unknown>;
const root = globalThis as unknown as Partial<Root>;
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as Record<string, unknown> | null;
    if (!saved) return;
    root.bccDemoTransfers = saved.bccDemoTransfers as unknown[];
    for (const key of ["bccDemoDetails", "bccDemoRequests", "bccDemoBankCalls", "bccDemoCallChecks"] as const) root[key] = new Map(saved[key] as [string, unknown][]);
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
  } catch { /* A full or blocked storage keeps the in-memory demo working. */ }
}

const cards: Record<string, string> = { "4400000000000002": ids.friend, "4400000000000003": ids.stranger, "4400000000000004": ids.hub };
const uuid = (value: string | undefined) => z.uuid().parse(value);

function dispatch(method: string, route: string, search: URLSearchParams, body: unknown): unknown {
  const path = route.split("/");
  if (method === "POST" && route === "transfers/evaluate") {
    const { recipient_card, ...rest } = transferSchema.parse(body);
    if (recipient_card) {
      if (!cards[recipient_card]) throw new ApiError("cardUnsupported", 422);
      rest.recipient_id = cards[recipient_card];
    }
    return evaluateDemo(rest);
  }
  if (method === "POST" && /^transfers\/[0-9a-f-]{36}\/resolve-cooling$/i.test(route)) return resolveDemo(uuid(path[1]), z.object({ answers: answersSchema }).strict().parse(body).answers);
  if (method === "POST" && /^transfers\/[0-9a-f-]{36}\/cancel$/i.test(route)) return cancelDemo(uuid(path[1]));
  if (method === "POST" && /^transfers\/requests\/[0-9a-f-]{36}\/abandon$/i.test(route)) return abandonDemo(uuid(path[2]));
  if (method === "GET" && /^transfers\/[0-9a-f-]{36}$/i.test(route)) return detailDemo(uuid(path[1]));
  if (method === "GET" && route === "soc/feed") return feedDemo(feedQuerySchema.parse(Object.fromEntries(search)));
  if (method === "GET" && /^soc\/graph\/[0-9a-f-]{36}$/i.test(route)) return graphDemo(uuid(path[2]), z.coerce.number().int().min(1).max(3).parse(search.get("depth") ?? 2));
  if (method === "POST" && (route === "call-check" || route === "call-check/demo/bank-call")) {
    const { customer_id } = z.object({ customer_id: z.uuid() }).strict().parse(body);
    return route === "call-check" ? callCheckDemo(customer_id) : bankCallDemo(customer_id);
  }
  // The trusted circle needs Bekzat's live integrations; the static demo has none.
  if (route.startsWith("trusted-circle/")) throw new ApiError("unavailable", 404);
  throw new ApiError("notFound", 404);
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

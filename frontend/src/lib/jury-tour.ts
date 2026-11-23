import { z } from "zod";
import { api, type Evaluation, type Graph } from "./contracts";
import { callLogRecord, contactBlock, decision, graphDemo } from "./demo";
import { ids } from "./demo-ids";
import { randomId } from "./secure-fallback";
import transfer from "./jury-transfer.json";

// Several views can belong to one stop. The progress indicator counts only these six stops.
export const tourSteps = [
  ["transfer"], ["caller", "payee"], ["call", "verdict"],
  ["telegram", "blocked"], ["feed", "graph", "model"], ["report", "document", "saved"],
] as const;
const views = tourSteps.flat();
export type TourView = typeof views[number];
export function tourStep(view: TourView) {
  return tourSteps.findIndex(step => step.some(item => item === view)) + 1;
}

const stamp = z.number().int().min(0).max(8.64e15 - 900_000);
const sessionSchema = z.object({
  view: z.enum(views), id: z.uuid(), started: stamp,
  checked: stamp.nullable(), blocked: stamp.nullable(),
  answers: z.object({ caller_claims_bank_or_police: z.boolean().optional(), knows_recipient_personally: z.boolean().optional() }),
}).refine(state => (state.checked !== null) === (views.indexOf(state.view) >= views.indexOf("verdict"))
  && (state.blocked !== null) === (views.indexOf(state.view) >= views.indexOf("blocked")));
export type TourSession = z.infer<typeof sessionSchema>;
export const tourStorageKey = "saqbol.jury-tour.v1";
type StorageAccess = () => Pick<Storage, "getItem" | "setItem" | "removeItem">;
const tabStorage: StorageAccess = () => window.sessionStorage;

export function newTour(): TourSession {
  return { view: "transfer", id: randomId(), started: Date.now(), checked: null, blocked: null, answers: {} };
}
export function readTour(storage: StorageAccess = tabStorage): TourSession {
  try {
    const saved = sessionSchema.safeParse(JSON.parse(storage().getItem(tourStorageKey) ?? "null"));
    if (saved.success) return saved.data;
  } catch { /* Private browsing can disable sessionStorage entirely. */ }
  return newTour();
}
export function saveTour(state: TourSession | null, storage: StorageAccess = tabStorage) {
  try {
    if (state) storage().setItem(tourStorageKey, JSON.stringify(state));
    else storage().removeItem(tourStorageKey);
  } catch { /* The active visit continues in React state. */ }
}
export function nextTour(state: TourSession, answer?: boolean): TourSession {
  const view = views[views.indexOf(state.view) + 1];
  if (!view) return state;
  const next = { ...state, view };
  if (state.view === "transfer") next.started = Date.now();
  if (typeof answer === "boolean") {
    const question = state.view === "caller" ? "caller_claims_bank_or_police" : state.view === "payee" ? "knows_recipient_personally" : null;
    if (question) next.answers = { ...state.answers, [question]: answer };
  }
  if (state.view === "call") next.checked = Date.now();
  if (state.view === "telegram") next.blocked = Date.now();
  return next;
}

/** The guide's Next always moves one numbered step. Only tapped answers enter the report. */
export function nextTourStep(state: TourSession): TourSession {
  let next = state;
  while (next.view !== "saved" && tourStep(next.view) === tourStep(state.view)) next = nextTour(next);
  return next;
}

export const warmupLimit = 60_000;
type StandData = { source: "api" | "local"; graph: Graph };
export const localGraph = () => graphDemo(ids.hub, 1, () => false);
export function senderCount(graph: Graph) {
  return new Set(graph.edges.filter(edge => edge.target === graph.center && edge.data.edge_type === "transfer").map(edge => edge.source)).size;
}
const staticSite = process.env.NEXT_PUBLIC_BCC_STATIC === "1";
async function probeBackend(signal: AbortSignal) {
  // Pages has no route handlers. Its credential-free probe goes to the hosted frontend.
  const host = staticSite ? "https://saq-bol-bcc.zerdeliportald.workers.dev" : "";
  const response = await fetch(`${host}/health?tour=1`, { signal, cache: "no-store", credentials: "omit" });
  if (!response.ok) return "local";
  const { source } = await response.json();
  if (source === "starting") return "starting";
  return source === "api" && !staticSite ? "api" : "local";
}
const readGraph = (signal: AbortSignal) => api<Graph>(`soc/graph/${ids.hub}?depth=1`, { signal });

/** Bound the whole cold start, including the first read. No tour action writes to the shared SOC. */
export async function prepareTour(signal: AbortSignal, probe = probeBackend, graph = readGraph, limit = warmupLimit): Promise<StandData> {
  const local: StandData = { source: "local", graph: localGraph() };
  if (signal.aborted) return local;
  const pending = new AbortController();
  const stop = () => pending.abort();
  signal.addEventListener("abort", stop, { once: true });
  const deadline = setTimeout(stop, limit);
  let retry: ReturnType<typeof setTimeout> | undefined;
  const ended = new Promise<StandData>(resolve => pending.signal.addEventListener("abort", () => resolve(local), { once: true }));
  async function load(): Promise<StandData> {
    while (!pending.signal.aborted) {
      const source = await probe(pending.signal);
      if (pending.signal.aborted) return local;
      if (source === "api") {
        const snapshot = await graph(pending.signal);
        return snapshot.center === ids.hub && senderCount(snapshot) > 1 && snapshot.nodes.some(node => node.id === ids.hub && node.data.suspected_mule)
          ? { source, graph: snapshot } : local;
      }
      if (source !== "starting") return local;
      await Promise.race([new Promise<void>(resolve => { retry = setTimeout(resolve, 2000); }), ended]);
    }
    return local;
  }
  try { return await Promise.race([ended, load().catch(() => local)]); }
  finally { clearTimeout(deadline); clearTimeout(retry); signal.removeEventListener("abort", stop); stop(); }
}

// Initial evaluation recorded with AntifraudEngine and bcc-synthetic-rf-v3 before the
// recipient's network investigation. Its scores and tree-path contributions are replayed verbatim.
export function tourCase(state: TourSession) {
  const at = new Date(state.started).toISOString();
  const held = decision("cooling_off", transfer.risk_score, state.id, transfer.reasons);
  const resolved = state.blocked === null ? null : new Date(state.blocked).toISOString();
  const outcome = resolved ? contactBlock({ ...held, reasons: transfer.reasons }) : { ...held, reasons: transfer.reasons };
  return {
    ...transfer, ...outcome,
    is_new_recipient: true, is_new_device: false, recipient: { id: ids.hub, display_name: "Марат Т.", iban_masked: "KZ** •••• 0004" },
    created_at: at, updated_at: resolved ?? at, resolved_at: resolved,
    cooling_off_until: resolved ? null : new Date(state.started + 900_000).toISOString(),
    ...(state.checked !== null && { bank_call_evidence: { outbound_call_listed: false, checked_at: new Date(state.checked).toISOString() } }),
  } satisfies Evaluation;
}
export function tourCall(state: TourSession) {
  return state.checked === null ? null : callLogRecord(state.id, state.checked, null);
}

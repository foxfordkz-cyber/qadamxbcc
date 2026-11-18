import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appConfig } from "@/lib/config";
import { accessConfiguration, backendHeaders, checkAccess } from "@/lib/server-access";
import { readBoundedJson, RequestBodyError } from "@/lib/request-body";
import { apiAdmission } from "@/lib/request-quota";
import { knownConflicts, ownerCapability, sanitizeContacts, sanitizeNotifications, signingKey, type TrustedCircle } from "@/lib/trusted-circle";

// BFF for the phone's "notify a trusted contact" action (Bekzat's trusted-contacts API).
// The owner is derived from the server-side transaction record, never from the browser,
// and the short-lived owner capability is minted and used only on this server.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ transactionId: string }> };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const unavailable = () => json({ error: "unavailable" }, 404);
class Upstream extends Error { constructor(public status: number, public detail: string, public retryAfter: string | null) { super(detail); } }

async function upstream(path: string, init: { method?: string; headers: Record<string, string>; body?: string }) {
  const base = (process.env.BCC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  const response = await fetch(`${base}/api/v1/${path}`, { method: init.method ?? "GET", headers: init.headers, body: init.body, cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) {
    let detail = "";
    try { const value = await response.json() as { detail?: unknown }; if (typeof value.detail === "string") detail = value.detail; } catch { /* Non-JSON upstream errors stay generic. */ }
    throw new Upstream(response.status, detail, response.headers.get("retry-after"));
  }
  return response.json() as Promise<unknown>;
}

async function ownerOf(transactionId: string): Promise<{ owner: string; status: string } | null> {
  const feed = z.object({ items: z.array(z.object({ transaction_id: z.string(), status: z.string(), sender: z.object({ id: z.uuid() }) }).passthrough()) }).passthrough()
    .parse(await upstream(`soc/feed?q=${transactionId}&limit=1`, { headers: backendHeaders("soc/feed") }));
  const item = feed.items.find(value => value.transaction_id.toLowerCase() === transactionId.toLowerCase());
  return item ? { owner: item.sender.id, status: item.status } : null;
}

async function handle(request: NextRequest, context: RouteContext) {
  const access = checkAccess({ method: request.method, headers: request.headers, origin: request.nextUrl.origin, pathname: request.nextUrl.pathname });
  if (access) return json({ error: access.error }, access.status);
  const { transactionId } = await context.params;
  if (!z.uuid().safeParse(transactionId).success) return json({ error: "invalid" }, 422);
  // Demo capabilities are not customer authentication: off in the pilot, and only against the real backend.
  const key = signingKey();
  if (!key || accessConfiguration().environment === "pilot" || appConfig().mode !== "live") return unavailable();
  const admission = apiAdmission();
  if (admission.status !== 200) return json({ error: admission.status === 429 ? "rateLimited" : "apiError" }, admission.status, admission.retryAfter ? { "Retry-After": String(admission.retryAfter) } : {});
  try {
    const body = request.method === "POST" ? z.object({ contact_id: z.uuid() }).strict().parse(await readBoundedJson(request)) : null;
    const transaction = await ownerOf(transactionId);
    if (!transaction) return json({ error: "notFound" }, 404);
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${ownerCapability(transaction.owner, key)}` };
    if (body) {
      if (transaction.status !== "cooling_off") return json({ error: "active_cooling_required" }, 409);
      await upstream(`trusted-contacts/transactions/${transactionId}/notifications`, { method: "POST", headers, body: JSON.stringify(body) });
    }
    const notificationsOnly = request.method === "GET" && request.nextUrl.searchParams.get("scope") === "notifications";
    const [contacts, notifications] = await Promise.all([
      notificationsOnly ? Promise.resolve(null) : upstream("trusted-contacts", { headers }),
      upstream(`trusted-contacts/transactions/${transactionId}/notifications`, { headers }),
    ]);
    const result: Partial<TrustedCircle> = { notifications: sanitizeNotifications(notifications), ...(contacts ? sanitizeContacts(contacts) : {}) };
    return json(result);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.code }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "invalid" }, 422);
    if (error instanceof Upstream) {
      // 404 also covers a backend without Bekzat's routers; 503 means integrations are disabled.
      if (error.status === 404 || error.status === 503 || error.status === 401 || error.status === 403) return unavailable();
      if (error.status === 409) return json({ error: (knownConflicts as readonly string[]).includes(error.detail) ? error.detail : "conflict" }, 409);
      if (error.status === 429) return json({ error: "rateLimited" }, 429, error.retryAfter && /^\d{1,5}$/.test(error.retryAfter) ? { "Retry-After": error.retryAfter } : {});
      return json({ error: "apiError" }, 502);
    }
    return json({ error: "apiError" }, 502);
  }
}
export const GET = handle;
export const POST = handle;

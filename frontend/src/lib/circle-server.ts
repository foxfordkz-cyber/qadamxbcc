import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appConfig } from "./config";
import { accessConfiguration, checkAccess } from "./server-access";
import { RequestBodyError } from "./request-body";
import { apiAdmission } from "./request-quota";
import { knownConflicts, ownerCapability, signingKey } from "./trusted-circle";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const unavailable = () => json({ error: "unavailable" }, 404);
class Upstream extends Error { constructor(public status: number, public detail: string, public retryAfter: string | null) { super(detail); } }

export async function upstream(path: string, init: { method?: string; headers: Record<string, string>; body?: string }) {
  const base = (process.env.BCC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  const response = await fetch(`${base}/api/v1/${path}`, { method: init.method ?? "GET", headers: init.headers, body: init.body, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(8_000) });
  if (response.status >= 300 && response.status < 400) throw new Upstream(502, "unexpected_redirect", null);
  if (!response.ok) {
    let detail = "";
    try { const value = await response.json() as { detail?: unknown }; if (typeof value.detail === "string") detail = value.detail; } catch { /* Non-JSON upstream errors stay generic. */ }
    throw new Upstream(response.status, detail, response.headers.get("retry-after"));
  }
  return response.json() as Promise<unknown>;
}

export function deliveryChannel() {
  switch (process.env.BCC_INTEGRATIONS_TELEGRAM_MODE) {
    case "fake": return "FAKE";
    case "test": return "Telegram · TEST";
    case "disabled": return "OFF";
    default: return null;
  }
}

export function circleAccess(request: NextRequest) {
  const denied = checkAccess({ method: request.method, headers: request.headers, origin: request.nextUrl.origin, pathname: request.nextUrl.pathname });
  if (denied) return { failure: json({ error: denied.error }, denied.status) };
  const config = appConfig();
  const key = signingKey();
  const owner = config.presets.normal.sender;
  if (!key || config.mode !== "live" || accessConfiguration().environment === "pilot" || !z.uuid().safeParse(owner).success) {
    return { failure: unavailable() };
  }
  const admission = apiAdmission();
  if (admission.status !== 200) return { failure: json({ error: admission.status === 429 ? "rateLimited" : "apiError" }, admission.status, admission.retryAfter ? { "Retry-After": String(admission.retryAfter) } : {}) };
  return { headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerCapability(owner, key)}` } };
}

export function circleFailure(error: unknown) {
  if (error instanceof RequestBodyError) return json({ error: error.code }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "invalid" }, 422);
  if (error instanceof Upstream) {
    if (error.status === 503 || error.status === 401 || error.status === 403) return unavailable();
    if (error.status === 404) return json({ error: "notFound" }, 404);
    if (error.status === 409) return json({ error: (knownConflicts as readonly string[]).includes(error.detail) ? error.detail : "conflict" }, 409);
    if (error.status === 429) return json({ error: "rateLimited" }, 429, error.retryAfter && /^\d{1,5}$/.test(error.retryAfter) ? { "Retry-After": error.retryAfter } : {});
    return json({ error: "apiError" }, 502);
  }
  return json({ error: "apiError" }, 502);
}

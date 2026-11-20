// Server route implementation. Credentials are read only here, never in client contracts.
import { z } from "zod";
import { checkAccess, accessConfiguration } from "./server-access";
import { readBoundedJson, RequestBodyError } from "./request-body";
import { apiAdmission } from "./request-quota";
import { caseActionSchema, openCaseSchema, validateSocIntegrationResponse } from "./soc-integrations";

if (typeof window !== "undefined") throw new Error("SOC proxy is server-only");

type Environment = Record<string, string | undefined>;
type Failure = { status: number; error: string };
type ProxyRoute = { path: string; body?: typeof openCaseSchema | typeof caseActionSchema };
type Dependencies = {
  env?: Environment;
  fetch?: typeof fetch;
  now?: () => number;
  admit?: () => { status: number; retryAfter: number };
};
const uuid = z.uuid();
const loopbackHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;
const loopbackAddress = /^(?:127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/i;
function isLoopbackHost(value: string): boolean {
  if (!loopbackHost.test(value)) return false;
  try { return !!new URL(`http://${value}`).hostname; } catch { return false; }
}

/** This is a localhost demo boundary, not bank IAM. Bind Next to 127.0.0.1. */
export function socProxyAccess(request: Request, env: Environment = process.env): Failure | null {
  let configuration;
  try { configuration = accessConfiguration(env); }
  catch { return { status: 503, error: "integrationsUnavailable" }; }
  if (configuration.environment === "pilot" || configuration.publicOrigin || env.BCC_MOBILE_LAN === "true" ||
      env.BCC_API_MODE !== "live" || env.NEXT_PUBLIC_BCC_STATIC === "1") {
    return { status: 503, error: "integrationsUnavailable" };
  }
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (!host || !isLoopbackHost(host) || !isLoopbackHost(url.host) || !["http:", "https:"].includes(url.protocol)) {
    return { status: 403, error: "integrationForbidden" };
  }
  // Never interpret a public reverse proxy as a localhost officer session.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (request.headers.has("forwarded") ||
      (forwardedHost !== null && forwardedHost.toLowerCase() !== host.toLowerCase()) ||
      (forwardedFor !== null && !forwardedFor.split(",").every(value => loopbackAddress.test(value.trim())))) {
    return { status: 403, error: "integrationForbidden" };
  }
  const origin = request.headers.get("origin");
  const trustedOrigin = `${url.protocol}//${host}`;
  if (request.headers.get("sec-fetch-site") === "cross-site" ||
      (origin !== null && origin !== trustedOrigin) || (request.method === "POST" && origin === null)) {
    return { status: 403, error: "integrationForbidden" };
  }
  const access = checkAccess({ method: request.method, headers: request.headers, origin: url.origin, pathname: url.pathname }, env);
  return access ? { status: access.status, error: access.status === 415 ? "invalid" : "integrationForbidden" } : null;
}

export function socCapability(env: Environment = process.env, now = Date.now()): string | Failure {
  const token = env.BCC_SOC_CAPABILITY;
  if (!token) return { status: 503, error: "integrationsUnavailable" };
  const parts = /^soc:([0-9a-f-]{36}):(\d{10}):([0-9a-f]{64})$/i.exec(token);
  const seconds = Math.floor(now / 1000);
  if (!parts || !uuid.safeParse(parts[1]).success || Number(parts[2]) <= seconds || Number(parts[2]) > seconds + 3601) {
    return { status: 401, error: "integrationSessionExpired" };
  }
  // The backend validates the signature and role. This BFF never signs capabilities.
  return token;
}

/** A narrow route and query allowlist, not a general authenticated reverse proxy. */
export function resolveSocProxyRoute(parts: string[], method: string, query: URLSearchParams): ProxyRoute | Failure {
  const path = parts.join("/");
  let body: ProxyRoute["body"];
  let parameters: Record<string, "limit" | "version" | number> = {};
  if (path === "guardian/soc/cases") {
    if (method === "POST") body = openCaseSchema;
    else if (method === "GET") parameters = { limit: "limit", cursor: 500 };
    else return { status: 405, error: "invalid" };
  } else if (path === "guardian/soc/cases/analytics" || path === "health/details") {
    if (method !== "GET") return { status: 405, error: "invalid" };
  } else if (parts.length >= 4 && parts.slice(0, 3).join("/") === "guardian/soc/cases" && uuid.safeParse(parts[3]).success) {
    if (parts.length === 5 && parts[4] === "actions" && method === "POST") body = caseActionSchema;
    else if (method === "GET" && (parts.length === 4 || (parts.length === 5 && ["history", "notes", "evidence", "export"].includes(parts[4])))) {
      if (["history", "notes"].includes(parts[4])) parameters = { limit: "limit", after_version: "version" };
    } else return { status: 404, error: "notFound" };
  } else if (method === "GET" && parts[0] === "soc" && parts[1] === "transactions" && uuid.safeParse(parts[2]).success &&
      (parts.length === 3 || (parts.length === 4 && ["timeline", "summary"].includes(parts[3])))) {
    if (parts[3] === "timeline") parameters = { limit: "limit", cursor: 1024 };
  } else return { status: 404, error: "notFound" };
  for (const [key, value] of query) {
    const rule = parameters[key];
    if (!Object.hasOwn(parameters, key) || query.getAll(key).length !== 1) return { status: 422, error: "invalid" };
    if (typeof rule === "number") {
      if (!value.length || value.length > rule || /[\p{C}]/u.test(value)) return { status: 422, error: "invalid" };
    } else if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) ||
        (rule === "limit" ? Number(value) < 1 || Number(value) > 100 : Number(value) < 0)) {
      return { status: 422, error: "invalid" };
    }
  }
  return { path: `integrations/${path}`, body };
}

const safeDetails: Readonly<Record<string, number>> = {
  case_not_found: 404, case_expired: 410, case_idempotency_conflict: 409, case_write_conflict: 409,
  case_already_exists: 409, case_information_channel_unavailable: 409, case_version_conflict: 409,
  case_action_limit: 409, case_transition_not_permitted: 409, case_reopen_reason_required: 409,
  case_reopen_required: 409, case_information_pending: 409, case_information_not_found: 404,
  case_information_already_answered: 409, case_information_closed: 409, case_cursor_invalid: 400,
  case_input_invalid: 422, incident_not_found: 404, incident_expired: 410, transaction_not_found: 404,
  invalid_or_expired_timeline_cursor: 422,
};

export function safeSocProxyError(status: number, detail?: unknown): string {
  if (typeof detail === "string" && safeDetails[detail] === status) return detail;
  if (status === 401) return "integrationSessionExpired";
  if (status === 403) return "integrationForbidden";
  if (status === 404) return "notFound";
  if (status === 409) return "conflict";
  if (status === 410) return "case_expired";
  if (status === 400 || status === 422) return "invalid";
  if (status === 429) return "rateLimited";
  if (status === 503) return "integrationsUnavailable";
  return "apiError";
}

function json(value: unknown, status = 200, retryAfter?: string): Response {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  if (retryAfter && /^\d{1,4}$/.test(retryAfter) && Number(retryAfter) >= 1 && Number(retryAfter) <= 3600) headers.set("Retry-After", retryAfter);
  return new Response(JSON.stringify(value), { status, headers });
}

async function upstreamJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("Invalid upstream response");
  const request = new Request("http://localhost/response", {
    method: "POST", headers: { "content-type": "application/json" }, body: response.body, duplex: "half",
  } as RequestInit & { duplex: "half" });
  return readBoundedJson(request, maxBytes);
}

export async function proxySocIntegration(request: Request, parts: string[], dependencies: Dependencies = {}): Promise<Response> {
  const env = dependencies.env ?? process.env;
  const access = socProxyAccess(request, env);
  if (access) return json({ error: access.error }, access.status);
  const url = new URL(request.url);
  const route = resolveSocProxyRoute(parts, request.method, url.searchParams);
  if ("status" in route) return json({ error: route.error }, route.status);
  const capability = socCapability(env, dependencies.now?.());
  if (typeof capability !== "string") return json({ error: capability.error }, capability.status);
  let backend: URL;
  try {
    backend = new URL(env.BCC_API_URL ?? "http://127.0.0.1:8000");
    if (!["http:", "https:"].includes(backend.protocol) || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== "/") throw new Error();
  } catch { return json({ error: "integrationsUnavailable" }, 503); }
  let body: string | undefined;
  const headers = new Headers({ "Accept": "application/json", "Authorization": `Bearer ${capability}` });
  if (route.body) {
    const key = request.headers.get("idempotency-key");
    if (!uuid.safeParse(key).success) return json({ error: "invalid" }, 422);
    try {
      body = JSON.stringify(route.body.parse(await readBoundedJson(request)));
    } catch (error) {
      return json({ error: error instanceof RequestBodyError ? error.code : "invalid" }, error instanceof RequestBodyError ? error.status : 422);
    }
    headers.set("Content-Type", "application/json");
    headers.set("Idempotency-Key", key!);
  }
  const admission = dependencies.admit?.() ?? apiAdmission(env);
  if (admission.status !== 200) return json({ error: admission.status === 429 ? "rateLimited" : "integrationsUnavailable" }, admission.status, String(admission.retryAfter));
  backend.pathname = `/api/v1/${route.path}`;
  backend.search = url.search;
  try {
    const response = await (dependencies.fetch ?? fetch)(backend, {
      method: request.method, headers, body, cache: "no-store", redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    });
    if (response.status >= 300 && response.status < 400) return json({ error: "integrationsUnavailable" }, 502);
    if (!response.ok) {
      let detail: unknown;
      try {
        const value = await upstreamJson(response, 16_384);
        if (value && typeof value === "object" && "detail" in value) detail = value.detail;
      } catch { /* Do not echo proxy pages, raw backend errors or credentials. */ }
      const status = [400, 401, 403, 404, 409, 410, 422, 429, 503].includes(response.status) ? response.status : 502;
      return json({ error: safeSocProxyError(status, detail) }, status, response.headers.get("retry-after") ?? undefined);
    }
    try {
      const result = validateSocIntegrationResponse(route.path, await upstreamJson(response, 1_048_576), request.method);
      if (route.path === "integrations/guardian/soc/cases" && body &&
          (result as { report_id: string }).report_id.toLowerCase() !== (JSON.parse(body) as { report_id: string }).report_id.toLowerCase()) throw new Error("Mismatched report");
      return json(result, response.status);
    } catch { return json({ error: "invalidResponse" }, 502); }
  } catch { return json({ error: "apiError" }, 502); }
}

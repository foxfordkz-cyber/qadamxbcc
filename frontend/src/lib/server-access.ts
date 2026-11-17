// Server-only access boundary for an internal pilot console, not customer authentication.
import { createHash, timingSafeEqual } from "node:crypto";

type AccessRequest = { method: string; headers: Headers; origin: string; pathname?: string };
type AccessFailure = { status: number; error: string; authenticate?: boolean };
type Environment = Record<string, string | undefined>;

function sameSecret(actual: string, expected: string): boolean {
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(actual), hash(expected));
}

export function checkAccess(request: AccessRequest, env: Environment = process.env): AccessFailure | null {
  const pilot = env.BCC_ENVIRONMENT === "pilot";
  let trustedOrigin = request.origin;
  // Next normalizes loopback URLs internally. Use the actual, strictly loopback
  // Host for local demos; the pilot always uses its configured HTTPS origin.
  const host = request.headers.get("host");
  if (!pilot && host && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) {
    trustedOrigin = `${new URL(request.origin).protocol}//${host}`;
  }
  if (pilot) {
    try {
      const configured = new URL(env.BCC_PUBLIC_ORIGIN || "");
      if (configured.protocol !== "https:" || configured.username || configured.password || configured.pathname !== "/" || configured.search || configured.hash) throw new Error("origin");
      trustedOrigin = configured.origin;
    } catch { return { status: 503, error: "Pilot access is not configured" }; }
    if (!env.BCC_PILOT_USER || !env.BCC_PILOT_PASSWORD || env.BCC_PILOT_PASSWORD.length < 24 ||
      !env.BCC_API_KEY || env.BCC_API_KEY.length < 32 || !env.BCC_SOC_API_KEY || env.BCC_SOC_API_KEY.length < 32 ||
      env.BCC_API_KEY === env.BCC_SOC_API_KEY || env.BCC_API_MODE !== "live" || env.BCC_DEMO_ACTIONS_ENABLED !== "false") {
      return { status: 503, error: "Pilot access is not configured" };
    }
    if (request.pathname !== "/health") {
      const header = request.headers.get("authorization") || "";
      let credentials = "";
      if (/^Basic [A-Za-z0-9+/]+={0,2}$/i.test(header) && header.length <= 2048) {
        credentials = Buffer.from(header.slice(6), "base64").toString("utf8");
      }
      if (!sameSecret(credentials, `${env.BCC_PILOT_USER}:${env.BCC_PILOT_PASSWORD}`)) {
        return { status: 401, error: "Authentication required", authenticate: true };
      }
    }
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin !== null && origin !== trustedOrigin) || (pilot && !origin)) {
      return { status: 403, error: "Untrusted request origin" };
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return { status: 415, error: "JSON content type required" };
    }
  }
  return null;
}

export function backendHeaders(route: string, env: Environment = process.env): Record<string, string> {
  const result: Record<string, string> = { "Content-Type": "application/json" };
  const soc = route.startsWith("soc/");
  const key = env[soc ? "BCC_SOC_API_KEY" : "BCC_API_KEY"];
  if (key) result[soc ? "X-BCC-SOC-Key" : "X-BCC-API-Key"] = key;
  return result;
}

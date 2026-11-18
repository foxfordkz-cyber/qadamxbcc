// Server-only access boundary for an internal pilot console, not customer authentication.
import { createHash, timingSafeEqual } from "node:crypto";
import { isPrivateLanHost, lanDemoEnabled } from "./mobile-link";

type AccessRequest = { method: string; headers: Headers; origin: string; pathname?: string };
type AccessFailure = { status: number; error: string; authenticate?: boolean };
type Environment = Record<string, string | undefined>;
type AccessConfiguration = { environment: "local" | "demo" | "pilot"; publicOrigin?: string };

// An absent environment remains the credential-free localhost demo, including a
// production Next build. A typo must never turn a credentialed proxy anonymous.
export function accessConfiguration(env: Environment = process.env): AccessConfiguration {
  const environment = env.BCC_ENVIRONMENT ?? "local";
  if (!["local", "demo", "pilot"].includes(environment) ||
    (env.BCC_API_MODE !== undefined && !["live", "demo"].includes(env.BCC_API_MODE)) ||
    (env.BCC_DEMO_ACTIONS_ENABLED !== undefined && !["true", "false"].includes(env.BCC_DEMO_ACTIONS_ENABLED)) ||
    (env.BCC_MOBILE_LAN !== undefined && !["true", "false"].includes(env.BCC_MOBILE_LAN))) {
    throw new Error("Invalid service access configuration");
  }
  const protectedValues = ["BCC_API_KEY", "BCC_SOC_API_KEY", "BCC_PILOT_USER", "BCC_PILOT_PASSWORD", "BCC_PUBLIC_ORIGIN"];
  if (environment !== "pilot") {
    if (protectedValues.some(name => env[name] !== undefined)) throw new Error("Credentials require pilot access protection");
    return { environment: environment as "local" | "demo" };
  }
  const keyIsValid = (key: string | undefined) => !!key && key.length >= 32 && key.trim() === key && new Set(key).size >= 12;
  if (!env.BCC_PILOT_USER || !/^[A-Za-z0-9_-]{3,64}$/.test(env.BCC_PILOT_USER) ||
    !env.BCC_PILOT_PASSWORD || env.BCC_PILOT_PASSWORD.length < 24 || env.BCC_PILOT_PASSWORD.trim() !== env.BCC_PILOT_PASSWORD ||
    !keyIsValid(env.BCC_API_KEY) || !keyIsValid(env.BCC_SOC_API_KEY) || env.BCC_API_KEY === env.BCC_SOC_API_KEY ||
    env.BCC_API_MODE !== "live" || env.BCC_DEMO_ACTIONS_ENABLED !== "false") {
    throw new Error("Pilot access is not configured");
  }
  const configured = new URL(env.BCC_PUBLIC_ORIGIN || "");
  if (configured.protocol !== "https:" || !configured.hostname || configured.hostname.includes("*") ||
    configured.username || configured.password || configured.pathname !== "/" || configured.search || configured.hash) {
    throw new Error("Pilot origin is not configured");
  }
  return { environment: "pilot", publicOrigin: configured.origin };
}

function sameSecret(actual: string, expected: string): boolean {
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(actual), hash(expected));
}

export function checkAccess(request: AccessRequest, env: Environment = process.env): AccessFailure | null {
  let configuration: AccessConfiguration;
  try { configuration = accessConfiguration(env); }
  catch { return { status: 503, error: "Service access is not configured" }; }
  const pilot = configuration.environment === "pilot";
  let trustedOrigin = request.origin;
  // Next normalizes loopback URLs internally. Use the actual, strictly loopback
  // Host for local demos; the pilot always uses its configured HTTPS origin.
  // With BCC_MOBILE_LAN=true a local demo also trusts its own private Wi-Fi IP,
  // so a jury phone can open /mobile; the Origin must still equal that Host.
  const host = request.headers.get("host");
  if (!pilot && host && (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host) || (lanDemoEnabled(env) && isPrivateLanHost(host)))) {
    trustedOrigin = `${new URL(request.origin).protocol}//${host}`;
  }
  if (pilot) {
    trustedOrigin = configuration.publicOrigin!;
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
  accessConfiguration(env);
  const result: Record<string, string> = { "Content-Type": "application/json" };
  const soc = route.startsWith("soc/");
  const key = env[soc ? "BCC_SOC_API_KEY" : "BCC_API_KEY"];
  if (key) result[soc ? "X-BCC-SOC-Key" : "X-BCC-API-Key"] = key;
  return result;
}

// Server-only access boundary for an internal pilot console, not customer authentication.
import { createHash, timingSafeEqual } from "node:crypto";
import { isPrivateLanHost, lanDemoEnabled } from "./mobile-link";

type AccessRequest = { method: string; headers: Headers; origin: string; pathname?: string };
type AccessFailure = { status: number; error: string; authenticate?: boolean };
type Environment = Record<string, string | undefined>;
type AccessConfiguration = { environment: "local" | "demo" | "pilot"; publicOrigin?: string };

const keyIsValid = (value: string | undefined) => !!value && value.length >= 32 && value.trim() === value && new Set(value).size >= 12;

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
  const demoKey = env.BCC_DEMO_UPSTREAM_API_KEY;
  const demoSocKey = env.BCC_DEMO_UPSTREAM_SOC_KEY;
  if (env.BCC_REQUIRE_DEMO_UPSTREAM !== undefined || demoKey !== undefined || demoSocKey !== undefined) {
    if ((env.BCC_REQUIRE_DEMO_UPSTREAM !== undefined && env.BCC_REQUIRE_DEMO_UPSTREAM !== "true") ||
      environment !== "demo" || env.BCC_API_MODE !== "live" || env.BCC_MOBILE_LAN === "true" ||
      !keyIsValid(demoKey) || !keyIsValid(demoSocKey) || demoKey === demoSocKey ||
      httpsOrigin(env.BCC_API_URL ?? "") === httpsOrigin(env.BCC_DEMO_PUBLIC_ORIGIN ?? "")) {
      throw new Error("Hosted demo upstream is not configured");
    }
  }
  const protectedValues = ["BCC_API_KEY", "BCC_SOC_API_KEY", "BCC_PILOT_USER", "BCC_PILOT_PASSWORD", "BCC_PUBLIC_ORIGIN"];
  if (environment !== "pilot") {
    if (protectedValues.some(name => env[name] !== undefined)) throw new Error("Credentials require pilot access protection");
    // A credential-free public demo behind a hosting proxy (Render, Railway) states
    // the HTTPS origin browsers use; Next only sees the proxy's internal URL.
    if (env.BCC_DEMO_PUBLIC_ORIGIN !== undefined) {
      if (environment !== "demo") throw new Error("A public origin requires the demo environment");
      return { environment: "demo", publicOrigin: httpsOrigin(env.BCC_DEMO_PUBLIC_ORIGIN) };
    }
    return { environment: environment as "local" | "demo" };
  }
  if (!env.BCC_PILOT_USER || !/^[A-Za-z0-9_-]{3,64}$/.test(env.BCC_PILOT_USER) ||
    !env.BCC_PILOT_PASSWORD || env.BCC_PILOT_PASSWORD.length < 24 || env.BCC_PILOT_PASSWORD.trim() !== env.BCC_PILOT_PASSWORD ||
    !keyIsValid(env.BCC_API_KEY) || !keyIsValid(env.BCC_SOC_API_KEY) || env.BCC_API_KEY === env.BCC_SOC_API_KEY ||
    env.BCC_API_MODE !== "live" || env.BCC_DEMO_ACTIONS_ENABLED !== "false") {
    throw new Error("Pilot access is not configured");
  }
  return { environment: "pilot", publicOrigin: httpsOrigin(env.BCC_PUBLIC_ORIGIN || "") };
}

function httpsOrigin(value: string): string {
  const configured = new URL(value);
  if (configured.protocol !== "https:" || !configured.hostname || configured.hostname.includes("*") ||
    configured.username || configured.password || configured.pathname !== "/" || configured.search || configured.hash) {
    throw new Error("Public origin is not configured");
  }
  return configured.origin;
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
  let trustedOrigin = configuration.publicOrigin ?? request.origin;
  // Next normalizes loopback URLs internally. Use the actual, strictly loopback
  // Host for local demos; the pilot always uses its configured HTTPS origin.
  // With BCC_MOBILE_LAN=true a local demo also trusts its own private Wi-Fi IP,
  // so a jury phone can open /mobile; the Origin must still equal that Host.
  const host = request.headers.get("host");
  if (!configuration.publicOrigin && host && (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host) || (lanDemoEnabled(env) && isPrivateLanHost(host)))) {
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
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin !== null && origin !== trustedOrigin) || ((pilot || env.BCC_DEMO_UPSTREAM_API_KEY) && !origin)) {
      return { status: 403, error: "Untrusted request origin" };
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return { status: 415, error: "JSON content type required" };
    }
  }
  return null;
}

export function backendHeaders(route: string, env: Environment = process.env): Record<string, string> {
  const configuration = accessConfiguration(env);
  const result: Record<string, string> = { "Content-Type": "application/json" };
  const soc = route.startsWith("soc/");
  const key = configuration.environment === "demo"
    ? env[soc ? "BCC_DEMO_UPSTREAM_SOC_KEY" : "BCC_DEMO_UPSTREAM_API_KEY"]
    : env[soc ? "BCC_SOC_API_KEY" : "BCC_API_KEY"];
  if (key) result[soc ? "X-BCC-SOC-Key" : "X-BCC-API-Key"] = key;
  return result;
}

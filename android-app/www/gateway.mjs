import { allowedHost } from "./lib.mjs";
import { Capacitor, CapacitorHttp } from "./vendor/capacitor.js";
export function gatewayOrigin(input) {
  try {
    const url = new URL(
      /^[a-z]+:\/\//i.test(input) ? input : `http://${input}`,
    );
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !(allowedHost(url.hostname) || url.hostname === "127.0.0.1") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    if (
      url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname)
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
export class GatewayError extends Error {
  constructor(status, retryAfter = null) {
    super(`gateway_${status}`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
async function gatewayFetch(url, options) {
  if (!Capacitor.isNativePlatform()) return fetch(url, options);
  const result = await CapacitorHttp.request({
    url,
    method: options.method,
    headers: options.headers,
    data: options.body === undefined ? undefined : JSON.parse(options.body),
    disableRedirects: true,
    connectTimeout: 10000,
    readTimeout: 20000,
  });
  return new Response(
    result.status === 204 ? null : JSON.stringify(result.data),
    {
      status: result.status,
      headers: result.headers,
    },
  );
}
export class Gateway {
  constructor(origin, fetcher = gatewayFetch, pinnedOrigin = null) {
    this.origin = pinnedOrigin && origin === pinnedOrigin &&
      /^https:\/\/[a-z0-9.-]+$/i.test(origin) ? origin : gatewayOrigin(origin);
    if (!this.origin) throw new Error("invalid_origin");
    this.fetcher = fetcher;
    this.token = null;
    this.role = null;
  }
  async request(path, method = "GET", body, idempotencyKey) {
    if (
      !/^\/(?:sessions?$|auth\/login$|account$|inbox$|requests$|transfers(?:\?|$)|api\/)/.test(path) ||
      path.includes("..")
    )
      throw new Error("invalid_path");
    const headers = { "Content-Type": "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    let response;
    try {
      response = await this.fetcher(`${this.origin}/mobile/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new GatewayError(0);
    } // Never replay a mutation with an unknown outcome.
    if (!response.ok) {
      if (response.status === 401) {
        this.token = null;
        this.role = null;
      }
      throw new GatewayError(
        response.status,
        response.headers.get("Retry-After"),
      );
    }
    if (response.status === 204) return null;
    return response.json();
  }
  async login(code) {
    const result = await this.request("/sessions", "POST", { code });
    if (
      !["client", "admin"].includes(result.role) ||
      typeof result.token !== "string"
    )
      throw new GatewayError(502);
    this.token = result.token;
    this.role = result.role;
    return result;
  }
  async logout() {
    try {
      await this.request("/session", "DELETE");
    } finally {
      this.token = null;
      this.role = null;
    }
  }
  api(path, method = "GET", body, key) {
    return this.request(`/api/${path}`, method, body, key);
  }
}
export function remainingSeconds(evaluation, receivedAt, now = Date.now()) {
  if (!evaluation?.cooling_off_until || !evaluation.server_time) return 0;
  const deadline = Date.parse(evaluation.cooling_off_until),
    server = Date.parse(evaluation.server_time);
  if (!Number.isFinite(deadline) || !Number.isFinite(server)) return 0;
  return Math.max(
    0,
    Math.ceil((deadline - server - Math.max(0, now - receivedAt)) / 1000),
  );
}

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
export const isWalletRole = role => ["client", "admin", "platform_admin"].includes(role);
async function gatewayFetch(url, options, timeoutMs) {
  if (!Capacitor.isNativePlatform()) return fetch(url, options);
  const result = await CapacitorHttp.request({
    url,
    method: options.method,
    headers: options.headers,
    data: options.body === undefined ? undefined : JSON.parse(options.body),
    disableRedirects: true,
    connectTimeout: 10000,
    readTimeout: timeoutMs,
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
    this.pendingReads = new Map();
    this.token = null;
    this.role = null;
  }
  request(path, method = "GET", body, idempotencyKey) {
    if (method !== "GET" || !this.token) return this.send(path, method, body, idempotencyKey);
    const key = JSON.stringify([path, this.subject, this.role, this.token]);
    if (!this.pendingReads.has(key)) {
      const request = this.send(path, method).finally(() => this.pendingReads.delete(key));
      this.pendingReads.set(key, request);
    }
    return this.pendingReads.get(key);
  }
  async send(path, method, body, idempotencyKey) {
    const inboxPath = path === "/inbox" || path === "/inbox?view=actions";
    if (
      (!inboxPath && !/^\/(?:sessions?$|auth\/login$|account$|requests$|wallet\/|protection\/|transfers(?:\?|$)|api\/|admin\/(?:metrics|staff(?:\/[\da-f-]{36})?)$|callbacks(?:\/[\da-f-]{36}\/answer)?$|(?:cases|reports)\/[\da-f-]{36}\/callback$)/i.test(path)) ||
      path.includes("..")
    )
      throw new Error("invalid_path");
    const headers = { "Content-Type": "application/json" };
    if (this.webSession) {
      headers["X-Qadam-Web"] = "1";
      if (path === "/auth/login") headers["X-Qadam-Remember"] = this.remember === false ? "0" : "1";
      if (this.subject) headers["X-Qadam-Subject"] = this.subject;
    } else if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const timeoutMs = path === "/auth/login" || path === "/sessions" ? 120000 : 20000;
    const sentToken = this.token;
    let response;
    try {
      response = await this.fetcher(`${this.origin}/mobile/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        credentials: this.webSession ? "same-origin" : "omit",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      }, timeoutMs);
    } catch {
      throw new GatewayError(0);
    } // Never replay a mutation with an unknown outcome.
    if (!response.ok) {
      if (response.status === 401 && this.token === sentToken) {
        this.token = null;
        this.role = null;
        if (sentToken) this.onExpired?.();
      }
      if (response.status === 409 && (await response.json().catch(() => null))?.detail === "disputed_amount_reserved") {
        throw Object.assign(new GatewayError(409), {code:"disputed_amount_reserved"});
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
      !isWalletRole(result.role) ||
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

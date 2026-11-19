// Pure helpers for the connect screen (unit-tested in tests/lib.test.mjs).

const PRIVATE_IPV4 = /^(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}$/;
export const DEFAULT_PORT = 3000;

/** Hosts the app may open inside itself: the demo laptop on the same Wi-Fi (or an emulator's host). */
export function allowedHost(host) {
  if (host === "localhost" || host === "10.0.2.2") return true;
  return PRIVATE_IPV4.test(host) && host.split(".").every(part => Number(part) <= 255);
}

/**
 * Accepts what the SOC QR encodes ("http://192.168.1.23:3105/mobile") or what a person types
 * ("192.168.1.23:3105", "192.168.1.23"). Returns the /mobile URL or an error key.
 */
export function parseServer(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { error: "empty" };
  let url;
  try { url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`); } catch { return { error: "invalid" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "invalid" };
  if (url.username || url.password) return { error: "invalid" };
  if (!allowedHost(url.hostname)) return { error: "notLocal" };
  const port = url.port || (/^[a-z]+:\/\//i.test(raw) ? "" : String(DEFAULT_PORT));
  const origin = `${url.protocol}//${url.hostname}${port ? `:${port}` : ""}`;
  return { origin, url: `${origin}/mobile`, label: `${url.hostname}${port ? `:${port}` : ""}` };
}

/** Most recent first, unique, at most five. */
export function rememberServer(list, label) {
  return [label, ...(Array.isArray(list) ? list : []).filter(item => typeof item === "string" && item !== label)].slice(0, 5);
}

/** Per-process admission for the internal console and the in-memory demo. */
export class RequestQuota {
  private tokens: number;
  private at: number;
  constructor(readonly perMinute: number, now = performance.now()) { this.tokens = perMinute; this.at = now; }
  take(now = performance.now()): number {
    this.tokens = Math.min(this.perMinute, this.tokens + Math.max(0, now - this.at) * this.perMinute / 60_000);
    this.at = Math.max(this.at, now);
    if (this.tokens < 1) return Math.max(1, Math.ceil((1 - this.tokens) * 60 / this.perMinute));
    this.tokens -= 1;
    return 0;
  }
}
const root = globalThis as typeof globalThis & { bccApiQuota?: RequestQuota };
export function apiAdmission(env: Record<string, string | undefined> = process.env) {
  const value = env.BCC_REQUEST_RATE_LIMIT_PER_MINUTE ?? "120";
  const limit = Number(value);
  if (!/^\d+$/.test(value) || limit < 1 || limit > 10_000) return { status: 503, retryAfter: 0 };
  if (root.bccApiQuota?.perMinute !== limit) root.bccApiQuota = new RequestQuota(limit);
  const retryAfter = root.bccApiQuota.take();
  return { status: retryAfter ? 429 : 200, retryAfter };
}

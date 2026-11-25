// A failed read never retries a financial mutation.
export class PollBackoff {
  failures = 0;
  next = 0;
  rateLimited = false;
  ready(now) { return now >= this.next; }
  success(now, interval) { this.failures = 0; this.rateLimited = false; this.next = now + interval; }
  failure(now, status, retryAfter) {
    this.failures = Math.min(6, this.failures + 1);
    this.rateLimited = status === 429;
    const provider = Number(retryAfter);
    const delay = this.rateLimited ? (Number.isFinite(provider) && provider > 0 ? provider * 1000 : 60000)
      : Math.min(60000, 3000 * 2 ** (this.failures - 1));
    this.next = now + delay;
  }
  reconnect() { if (!this.rateLimited) this.next = 0; }
}

export const pollInterval = page => ["case", "cases", "reports", "reportDetail", "contacts", "safety"].includes(page)
  ? 15000 : ["timeline", "notifications", "socAnalytics", "analytics"].includes(page) ? 60000 : 3000;

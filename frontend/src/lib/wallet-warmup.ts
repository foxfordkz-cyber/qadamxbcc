import wallets from "./connected-wallet.json";

const destinations = { wallet: wallets.url, soc: wallets.socUrl, jury: wallets.juryUrl, trial: new URL("jury/trial", wallets.juryUrl).href };
export type Stand = keyof typeof destinations;

export function walletEntry(stand: Stand, staticExport = process.env.NEXT_PUBLIC_BCC_STATIC === "1"): string {
  return staticExport ? destinations[stand] : "/connect?stand=" + stand;
}

export function walletDestination(stand: string) {
  return Object.hasOwn(destinations, stand) ? destinations[stand as Stand] : null;
}

type WalletProbe = "ready" | "pending" | "open_in_browser";

export async function probeWallet(stand: string, fetcher = fetch): Promise<WalletProbe> {
  const target = walletDestination(stand);
  if (!target) return "pending";
  const jury = stand === "jury" || stand === "trial";
  const probe = jury ? wallets.readiness.jury : wallets.readiness.team;
  try {
    const result = await fetcher(new URL(probe.url, target), {
      method: "GET", credentials: "omit", redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (result.status === 429 && result.headers.get("x-render-routing") === "hibernate-rate-limited") {
      return "open_in_browser";
    }
    if (!result.ok || !result.headers.get("content-type")?.includes("application/json")) return "pending";
    const body: unknown = await result.json();
    if (typeof body !== "object" || body === null || !("status" in body) || body.status !== probe.status) return "pending";
    if (jury && (!("mode" in body) || body.mode !== wallets.readiness.jury.mode)) return "pending";
    return "ready";
  } catch {
    return "pending";
  }
}

export async function shouldOpenWallet(response: Response): Promise<boolean> {
  if (!response.ok && response.status !== 429 && response.status !== 503) return false;
  if (!response.headers.get("content-type")?.includes("application/json")) return false;
  const body = await response.json();
  if (response.ok) return body?.ready === true;
  if (response.status === 503) return body?.ready === false;
  return body?.open_directly === true;
}

import wallets from "./connected-wallet.json";

const destinations = { wallet: wallets.url, soc: wallets.socUrl, jury: wallets.juryUrl, trial: new URL("jury/trial", wallets.juryUrl).href };
export type Stand = keyof typeof destinations;

export function walletDestination(stand: string) {
  return Object.hasOwn(destinations, stand) ? destinations[stand as Stand] : null;
}

export async function probeWallet(stand: string, fetcher = fetch): Promise<boolean> {
  const target = walletDestination(stand);
  if (!target) return false;
  const jury = stand === "jury" || stand === "trial";
  const probe = jury ? wallets.readiness.jury : wallets.readiness.team;
  try {
    const result = await fetcher(new URL(probe.url, target), {
      method: "GET", credentials: "omit", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!result.ok || !result.headers.get("content-type")?.includes("application/json")) return false;
    const body: unknown = await result.json();
    return typeof body === "object" && body !== null && "status" in body && body.status === probe.status && (!jury || ("mode" in body && body.mode === wallets.readiness.jury.mode));
  } catch {
    return false;
  }
}

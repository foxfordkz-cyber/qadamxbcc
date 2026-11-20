import wallet from "../src/lib/connected-wallet.json" with { type: "json" };

/** Confirm that the mobile gateway serves the wallet, including after a cold start. */
export async function connectedWalletAvailable(request = fetch) {
  try {
    const response = await request(wallet.url, {
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return false;
    return /<html\b[^>]*\sdata-web-wallet(?=[\s=>])[^>]*>/i.test(await response.text());
  } catch {
    return false;
  }
}

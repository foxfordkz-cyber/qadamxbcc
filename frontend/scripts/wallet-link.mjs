// A healthy core API alone does not establish that the connected wallet was deployed.
export async function connectedWalletLink(origin, request = fetch) {
  const target = new URL(origin);
  if (target.protocol !== "https:" || target.username || target.password ||
      target.search || target.hash || target.pathname !== "/") {
    throw new Error("Expected a public HTTPS wallet origin");
  }
  const url = new URL("/wallet/", target).href;
  try {
    const response = await request(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return "";
    const html = await response.text();
    return /<html\b[^>]*\bdata-web-wallet\b[^>]*>/i.test(html) ? url : "";
  } catch {
    return "";
  }
}

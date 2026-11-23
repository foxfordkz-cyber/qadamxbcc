export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("tour") === "1") {
    // Keep the frontend liveness check independent of a sleeping Render instance.
    const reply = (source: "api" | "local" | "starting") => Response.json({ source }, {
      headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
    });
    try {
      const base = process.env.BCC_API_URL || "http://127.0.0.1:8000";
      const upstream = await fetch(new URL("/health", base), {
        cache: "no-store", redirect: "manual", signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
      });
      if ([502, 503, 504].includes(upstream.status)) return reply("starting");
      if (upstream.ok && (await upstream.json()).status === "ok" && process.env.BCC_API_MODE === "live") return reply("api");
    } catch { /* The isolated story is also available without the API. */ }
    return reply("local");
  }
  return Response.json({ status: "ok", service: "Saq Bol Frontend" }, { headers: { "Cache-Control": "no-store" } });
}

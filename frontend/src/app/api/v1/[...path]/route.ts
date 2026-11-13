import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { answersSchema, transferSchema } from "@/lib/contracts";
import { appConfig, ids } from "@/lib/config";
import { DemoError, evaluateDemo, feedDemo, graphDemo, resolveDemo } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ path: string[] }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function handle(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const route = path.join("/");
  const evaluate = request.method === "POST" && route === "transfers/evaluate";
  const resolve = request.method === "POST" && /^transfers\/[0-9a-f-]{36}\/resolve-cooling$/i.test(route);
  const feed = request.method === "GET" && route === "soc/feed";
  const graph = request.method === "GET" && /^soc\/graph\/[0-9a-f-]{36}$/i.test(route);
  if (!evaluate && !resolve && !feed && !graph) return json({ error: "notFound" }, 404);
  try {
    const config = appConfig();
    let body: unknown;
    if (evaluate) {
      const input = transferSchema.parse(await request.json());
      const { recipient_card, ...rest } = input;
      if (recipient_card) {
        const mapping = config.mode === "demo" ? { "4400000000000002": ids.friend, "4400000000000003": ids.stranger, "4400000000000004": ids.hub }
          : z.record(z.string(), z.uuid()).parse(JSON.parse(process.env.BCC_CARD_ACCOUNT_MAP || "{}"));
        const recipient = (mapping as Record<string, string>)[recipient_card];
        if (!recipient) return json({ error: "cardUnsupported" }, 422);
        rest.recipient_id = recipient;
      }
      if (config.mode === "demo") return json(evaluateDemo(rest));
      body = rest;
    }
    if (resolve) {
      const parsed = z.object({ answers: answersSchema }).strict().parse(await request.json());
      if (config.mode === "demo") return json(resolveDemo(path[1], parsed.answers));
      body = parsed;
    }
    if (config.mode === "demo") return json(feed ? feedDemo() : graphDemo(path[2]));
    const base = (process.env.BCC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const response = await fetch(`${base}/api/v1/${route}${request.nextUrl.search}`, {
      method: request.method, headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return json({ error: response.status === 404 ? "notFound" : response.status === 409 ? "conflict" : response.status === 422 ? "invalid" : "apiError" }, response.status);
    return json(await response.json());
  } catch (error) {
    if (error instanceof DemoError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "invalid" }, 422);
    return json({ error: "apiError" }, 502);
  }
}
export const GET = handle;
export const POST = handle;

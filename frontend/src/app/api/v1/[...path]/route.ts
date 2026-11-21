import { NextRequest, NextResponse } from "next/server";
import { returnActionInput, returnRoute, reviewInput } from "@/lib/payment-returns";
import { z } from "zod";
import { demoPayee, payeeInput, payeeResult } from "@/lib/payee-check";
import { traceRoute } from "@/lib/funds-trace";
import { anchorsRoute } from "@/lib/trace-anchors";
import { lookbackRoute, priorReceiptQuery } from "@/lib/recipient-lookback";
import { priorReceiptsDemo } from "@/lib/demo";
import { answersSchema, cancelSchema, feedQuerySchema, postCallSchema, transferSchema, validateApiResponse } from "@/lib/contracts";
import { recipientFlagInputSchema } from "@/lib/recipient-flag";
import { appConfig, ids } from "@/lib/config";
import { backendHeaders, checkAccess } from "@/lib/server-access";
import { readBoundedJson, RequestBodyError } from "@/lib/request-body";
import { apiAdmission } from "@/lib/request-quota";
import { abandonDemo, bankCallDemo, callCheckDemo, cancelDemo, DemoError, detailDemo, evaluateDemo, feedDemo, graphDemo, postCallDemo, recipientFlagDemo, resolveDemo, setRecipientFlagDemo } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ path: string[] }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function handle(request: NextRequest, context: RouteContext) {
  const access = checkAccess({ method: request.method, headers: request.headers, origin: request.nextUrl.origin, pathname: request.nextUrl.pathname });
  if (access) return json({ error: access.error }, access.status);
  const { path } = await context.params;
  const route = path.join("/");
  const lookback = request.method === "GET" && lookbackRoute.test(route);
  const linked = returnRoute(route);
  if (linked && (request.nextUrl.search || (linked.kind === "list" && request.method !== "GET") || (linked.kind === "review" && request.method !== "POST"))) return json({error:"notFound"}, 404);
  const evaluate = request.method === "POST" && route === "transfers/evaluate";
  const resolve = request.method === "POST" && /^transfers\/[0-9a-f-]{36}\/resolve-cooling$/i.test(route);
  const postCall = request.method === "POST" && /^transfers\/[0-9a-f-]{36}\/post-call$/i.test(route);
  const cancel = request.method === "POST" && /^transfers\/[0-9a-f-]{36}\/cancel$/i.test(route);
  const abandon = request.method === "POST" && /^transfers\/requests\/[0-9a-f-]{36}\/abandon$/i.test(route);
  const detail = request.method === "GET" && /^transfers\/[0-9a-f-]{36}$/i.test(route);
  const feed = request.method === "GET" && route === "soc/feed";
  const graph = request.method === "GET" && /^soc\/graph\/[0-9a-f-]{36}$/i.test(route);
  const fundsTrace = request.method === "GET" && (traceRoute.test(route) || anchorsRoute.test(route));
  if (fundsTrace && request.nextUrl.search) return json({ error: "invalid" }, 422);
  const recipientFlag = ["GET", "POST"].includes(request.method) && /^soc\/recipients\/[0-9a-f-]{36}\/flag$/i.test(route);
  const callCheck = request.method === "POST" && route === "call-check";
  const payee = request.method === "POST" && route === "payee-check" && !request.nextUrl.search;
  const bankCall = request.method === "POST" && route === "call-check/demo/bank-call";
  const guide = request.method === "GET" && route === "scam-check/guide";
  if (!linked && !evaluate && !resolve && !cancel && !postCall && !abandon && !detail && !feed && !graph && !fundsTrace && !recipientFlag && !lookback && !callCheck && !bankCall && !guide && !payee) return json({ error: "notFound" }, 404);
  if ((abandon || graph || fundsTrace || recipientFlag || lookback) && !z.uuid().safeParse(path[2]).success) return json({ error: "invalid" }, 422);
  if ((resolve || cancel || postCall || detail) && !z.uuid().safeParse(path[1]).success) return json({ error: "invalid" }, 422);
  const admission = apiAdmission();
  if (admission.status !== 200) {
    const response = json({ error: admission.status === 429 ? "rateLimited" : "apiError" }, admission.status);
    if (admission.retryAfter) response.headers.set("Retry-After", String(admission.retryAfter));
    return response;
  }
  try {
    const config = appConfig();
    if (lookback) {
      if (config.publicSocReadOnly || process.env.BCC_DEMO_PUBLIC_ORIGIN) return json({ error: "integrationForbidden" }, 403);
      const params = request.nextUrl.searchParams;
      if (params.size !== new Set(params.keys()).size) return json({ error: "invalid" }, 422);
      const query = priorReceiptQuery.parse(Object.fromEntries(params));
      if (config.mode === "demo") return json(priorReceiptsDemo(path[2], query));
    }
    if (linked && (config.mode !== "live" || config.accountMode !== "test" || !config.demoActionsEnabled)) return json({error:"notFound"}, 404);
    if (fundsTrace && config.mode === "demo") return json({ error: "traceBackendRequired" }, 501);
    if (config.publicSocReadOnly && route.startsWith("soc/") && request.method !== "GET") {
      return json({ error: "integrationForbidden" }, 403);
    }
    let body: unknown;
    if (payee) {
      if (!config.demoActionsEnabled || (config.mode !== "demo" && config.accountMode !== "test")) return json({ error: "notFound" }, 404);
      const input = payeeInput.parse(await readBoundedJson(request));
      if (config.mode === "demo") return json(demoPayee(input));
      body = input;
    }
    let returnTransfer = false;
    if (linked && request.method === "POST") {
      if (linked.kind === "review") body = reviewInput.parse(await readBoundedJson(request));
      else {
        const input = returnActionInput.parse(await readBoundedJson(request));
        body = input;
        returnTransfer = input.action === "return_to_sender";
      }
    }
    if (recipientFlag) {
      if (request.method === "POST") body = recipientFlagInputSchema.parse(await readBoundedJson(request));
      if (config.mode === "demo") return json(body ? setRecipientFlagDemo(path[2], recipientFlagInputSchema.parse(body)) : recipientFlagDemo(path[2]));
    }
    if (evaluate) {
      const input = transferSchema.parse(await readBoundedJson(request));
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
      const parsed = z.object({ answers: answersSchema, save_only: z.boolean().optional() }).strict().parse(await readBoundedJson(request));
      if (config.mode === "demo") return json(resolveDemo(path[1], parsed.answers, Date.now(), false, parsed.save_only));
      body = parsed;
    }
    if (callCheck || bankCall) {
      if (bankCall && config.demoActionsEnabled === false) return json({ error: "notFound" }, 404);
      const parsed = z.object({ customer_id: z.uuid() }).strict().parse(await readBoundedJson(request));
      if (config.mode === "demo") return json(callCheck ? callCheckDemo(parsed.customer_id) : bankCallDemo(parsed.customer_id));
      body = parsed;
    }
    if (postCall) {
      const parsed = postCallSchema.parse(await readBoundedJson(request));
      if (config.mode === "demo") return json(postCallDemo(path[1], parsed.action));
      body = parsed;
    }
    if (cancel) {
      const parsed = cancelSchema.parse(await readBoundedJson(request));
      if (config.mode === "demo") return json(cancelDemo(path[1], Date.now(), parsed.reason === "post_call_scam"));
      body = parsed;
    }
    if (abandon) body = z.object({}).strict().parse(await readBoundedJson(request));
    if (guide && config.mode === "demo") return json({ error: "unavailable" }, 503);
    if (abandon && config.mode === "demo") return json(abandonDemo(path[2]));
    if (config.mode === "demo") return json(detail ? detailDemo(path[1]) : feed ? feedDemo(feedQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams))) : graphDemo(path[2], z.coerce.number().int().min(1).max(3).parse(request.nextUrl.searchParams.get("depth") ?? 2)));
    const base = (process.env.BCC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const headers = backendHeaders(route);
    if ((evaluate || returnTransfer) && process.env.BCC_EDGE_SUBMISSION_LIMITS === "true") {
      const source = request.headers.get("x-bcc-submission-source") ?? "";
      if (!/^[a-f0-9]{64}$/.test(source)) return json({ error: "apiError" }, 503);
      headers["X-BCC-Submission-Source"] = source;
    }
    const response = await fetch(`${base}/api/v1/${route}${request.nextUrl.search}`, {
      method: request.method, headers,
      body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(10_000), redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) return json({ error: "apiError" }, 502);
    if (!response.ok) {
      if (recipientFlag && [404, 409].includes(response.status)) {
        const value: unknown = await response.json().catch(() => null);
        const code = value && typeof value === "object" && "detail" in value ? value.detail : null;
        if ((response.status === 404 && code === "account_not_found") || (response.status === 409 && ["flag_version_conflict", "flag_idempotency_conflict"].includes(String(code)))) return json({ error: code }, response.status);
      }
      if (evaluate && response.status === 429) {
        const payload = await response.json().catch(() => null);
        if (payload?.detail === "submission_cooldown") {
          const paused = json({ error: "submissionCooldown" }, 429);
          const retry = response.headers.get("retry-after");
          if (retry && /^\d{1,4}$/.test(retry)) paused.headers.set("Retry-After", retry);
          return paused;
        }
      }
      const rejected = json({ error: response.status === 404 ? "notFound" : response.status === 409 ? "conflict" : response.status === 422 ? "invalid" : response.status === 413 ? "requestTooLarge" : response.status === 429 ? "rateLimited" : "apiError" }, response.status);
      const retry = response.headers.get("retry-after");
      if (retry && /^\d{1,5}$/.test(retry)) rejected.headers.set("Retry-After", retry);
      return rejected;
    }
    let value: unknown;
    try { value = await response.json(); }
    catch { return json({ error: "invalidResponse" }, 502); }
    if (payee) {
      const reply = payeeResult.safeParse(value);
      const input = payeeInput.parse(body);
      if (!reply.success || reply.data.bank !== input.bank || reply.data.recipient !== input.recipient) return json({error: "invalidResponse"}, 502);
      return json(reply.data);
    }
    if (linked) {
      try { return json(validateApiResponse(route, value, request.method)); }
      catch { return json({error:"invalidResponse"}, 502); }
    }
    return json(recipientFlag || fundsTrace || lookback ? validateApiResponse(route + request.nextUrl.search, value, request.method) : value);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.code }, error.status);
    if (error instanceof DemoError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "invalid" }, 422);
    return json({ error: "apiError" }, 502);
  }
}
export const GET = handle;
export const POST = handle;

import { NextRequest } from "next/server";
import { z } from "zod";
import { circleAccess, circleFailure, json, upstream } from "@/lib/circle-server";
import { readBoundedJson } from "@/lib/request-body";
import { signalCodes } from "@/lib/message-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const category = z.enum(signalCodes);
const receipt = z.object({report_id: z.uuid(), category}).strict();
const options = z.array(z.object({id: z.uuid(), created_at: z.iso.datetime({offset: true})}).strict()).max(50);
async function handle(request: NextRequest) {
  const access = circleAccess(request);
  if (access.failure) return access.failure;
  try {
    const headers = access.headers;
    if (request.method === "GET") return json(options.parse(await upstream("integrations/guardian/report-signals", {headers})));
    const body = receipt.extend({consent: z.literal(true)}).parse(await readBoundedJson(request));
    const result = receipt.parse(await upstream(`integrations/guardian/reports/${body.report_id}/message-signal`, {
      method: "POST", headers, body: JSON.stringify({category: body.category, consent: true}),
    }));
    if (result.report_id !== body.report_id || result.category !== body.category) return json({error:"invalidResponse"}, 502);
    return json(result);
  } catch (error) { return circleFailure(error); }
}
export const GET = handle;
export const POST = handle;

import { NextRequest } from "next/server";
import { z } from "zod";
import { circleAccess, circleFailure, json, upstream } from "@/lib/circle-server";
import { readBoundedJson } from "@/lib/request-body";
import { invitationSchema, memberSchema, membershipSchema } from "@/lib/trusted-circle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: NextRequest) {
  const access = circleAccess(request);
  if (access.failure) return access.failure;
  const { headers } = access;
  try {
    if (request.method === "GET") return json(membershipSchema.parse(await upstream("trusted-contacts", { headers })));
    const data = await readBoundedJson(request);
    if (request.method === "DELETE") {
      const { contact_id } = z.object({ contact_id: z.uuid() }).strict().parse(data);
      return json(memberSchema.parse(await upstream(`trusted-contacts/${contact_id}`, { method: "DELETE", headers })));
    }
    const body = z.object({ language: z.enum(["ru", "kk"]), owner_consent: z.literal(true) }).strict().parse(data);
    const invitation = invitationSchema.parse(await upstream("trusted-contacts", { method: "POST", headers, body: JSON.stringify(body) }));
    return json(invitation, 201);
  } catch (error) { return circleFailure(error); }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;

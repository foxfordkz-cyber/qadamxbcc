import { NextRequest } from "next/server";
import { z } from "zod";
import { circleFailure, circleGate, circleWebEnabled, json, sessionCookie, sessionToken, upstream } from "@/lib/circle-server";
import { readBoundedJson } from "@/lib/request-body";
import { backendHeaders } from "@/lib/server-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const codeSchema = z.object({ code: z.string().regex(/^[0-9A-F]{16}$/) }).strict();
const sessionSchema = z.object({ session: sessionToken, expires_in: z.number().int().positive().max(900) });
const cookieOptions = { path: "/", secure: true, httpOnly: true, sameSite: "strict" as const };

async function handle(request: NextRequest) {
  const denied = circleGate(request);
  if (denied) return denied;
  if (!circleWebEnabled()) return json({ error: "unavailable" }, 404);
  const path = "trusted-contacts/web-session";
  const headers = backendHeaders(path);
  try {
    if (request.method === "GET") {
      const state = await upstream(path, { headers });
      if (!z.object({ available: z.literal(true) }).safeParse(state).success) return json({ error: "unavailable" }, 503);
      return json({ available: true });
    }
    if (request.method === "DELETE") {
      const token = sessionToken.safeParse(request.cookies.get(sessionCookie)?.value);
      if (token.success) await upstream(path, { method: "DELETE", headers: { ...headers, "X-BCC-Circle-Session": token.data } });
      const response = json({ signed_in: false });
      response.cookies.set(sessionCookie, "", { ...cookieOptions, maxAge: 0 });
      return response;
    }
    const body = codeSchema.parse(await readBoundedJson(request));
    const result = await upstream(path, { method: "POST", headers, body: JSON.stringify(body) });
    const session = sessionSchema.safeParse(result);
    if (!session.success) return json({ error: "unavailable" }, 502);
    const response = json({ signed_in: true });
    response.cookies.set(sessionCookie, session.data.session, { ...cookieOptions, maxAge: session.data.expires_in });
    return response;
  } catch (error) { return circleFailure(error); }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;

import { NextRequest } from "next/server";
import { z } from "zod";
import { circleAccess, circleFailure, deliveryChannel, json, upstream } from "@/lib/circle-server";
import { readBoundedJson } from "@/lib/request-body";
import { sanitizeContacts, sanitizeNotifications } from "@/lib/trusted-circle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ transactionId: string }> };

async function handle(request: NextRequest, context: RouteContext) {
  const access = circleAccess(request);
  if (access.failure) return access.failure;
  const { transactionId } = await context.params;
  if (!z.uuid().safeParse(transactionId).success) return json({ error: "invalid" }, 422);
  const { headers } = access;
  const path = `trusted-contacts/transactions/${transactionId}/notifications`;
  try {
    if (request.method === "POST") {
      const body = z.object({ contact_id: z.uuid() }).strict().parse(await readBoundedJson(request));
      // The backend verifies ownership, hold, consent, opt-in and deduplicates this pair.
      await upstream(path, { method: "POST", headers, body: JSON.stringify(body) });
    }
    const notificationsOnly = request.nextUrl.searchParams.get("scope") === "notifications";
    const [notifications, contacts] = await Promise.all([
      upstream(path, { headers }),
      notificationsOnly ? null : upstream("trusted-contacts", { headers }),
    ]);
    return json({ channel: deliveryChannel(), notifications: sanitizeNotifications(notifications), ...(contacts ? sanitizeContacts(contacts) : {}) });
  } catch (error) { return circleFailure(error); }
}
export const GET = handle;
export const POST = handle;

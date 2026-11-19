import { NextRequest, NextResponse } from "next/server";
import { checkAccess } from "./lib/server-access";

export function proxy(request: NextRequest) {
  const denied = checkAccess({ method: request.method, headers: request.headers, origin: request.nextUrl.origin, pathname: request.nextUrl.pathname });
  const response = denied
    ? NextResponse.json({ error: denied.error }, { status: denied.status, headers: denied.authenticate ? { "WWW-Authenticate": 'Basic realm="Saq Bol Pilot", charset="UTF-8"' } : undefined })
    : NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

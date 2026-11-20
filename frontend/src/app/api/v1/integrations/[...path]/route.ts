import { NextRequest } from "next/server";
import { proxySocIntegration } from "@/lib/soc-integration-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, { params }: Context) {
  return proxySocIntegration(request, (await params).path);
}

export async function POST(request: NextRequest, { params }: Context) {
  return proxySocIntegration(request, (await params).path);
}

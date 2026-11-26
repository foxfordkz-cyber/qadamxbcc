import { probeWallet, walletDestination } from "@/lib/wallet-warmup";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const stand = new URL(request.url).searchParams.get("stand") ?? "";
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (!walletDestination(stand)) return Response.json({ ready: false }, { status: 400, headers });
  const ready = await probeWallet(stand);
  if (!ready) headers.set("Retry-After", "4");
  return Response.json({ ready }, { status: ready ? 200 : 503, headers });
}

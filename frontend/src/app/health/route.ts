export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ status: "ok", service: "BCC Shield Frontend" }, { headers: { "Cache-Control": "no-store" } });
}

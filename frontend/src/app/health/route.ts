export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ status: "ok", service: "Saq Bol Frontend" }, { headers: { "Cache-Control": "no-store" } });
}

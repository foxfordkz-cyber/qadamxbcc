import { NextResponse } from "next/server";
import { accessConfiguration } from "@/lib/server-access";
import { lanAddresses } from "@/lib/mobile-link";

export const dynamic = "force-dynamic";

/** Where a phone can open /mobile: the pilot's public origin, or this laptop's Wi-Fi address in the LAN demo. */
export function GET() {
  const access = accessConfiguration();
  if (access.environment === "pilot") return NextResponse.json({ origins: [`${access.publicOrigin}`] });
  return NextResponse.json({ hosts: lanAddresses() });
}

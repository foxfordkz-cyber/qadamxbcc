import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import ShieldApp from "@/components/shield-app";
import { appConfig } from "@/lib/config";
import wallets from "@/lib/connected-wallet.json";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Saq Bol × BCC — SOC" };

export default async function OfficerPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  const config = appConfig();
  if (process.env.NEXT_PUBLIC_BCC_STATIC === "1") {
    return <main className="shell"><h1>Saq Bol × BCC</h1><a href={wallets.juryUrl}>Кіру / Войти</a></main>;
  }
  const host = (await headers()).get("host") ?? "";
  const loopback = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host);
  if (config.accountMode !== "pilot" && (!loopback || process.env.BCC_ENVIRONMENT === "demo" || process.env.BCC_DEMO_PUBLIC_ORIGIN)) {
    redirect(wallets.juryUrl);
  }
  const full = process.env.BCC_MOBILE_LAN !== "true" && (await searchParams).workspace === "full";
  return <ShieldApp config={config} layout={full ? "full" : "officer"} />;
}

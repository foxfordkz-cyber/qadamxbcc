import type { Metadata } from "next";
import ShieldApp from "@/components/shield-app";
import { appConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Saq Bol × BCC — SOC" };

export default function OfficerPage() {
  return <ShieldApp config={appConfig()} layout="officer" />;
}

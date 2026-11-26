import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PitchConsole from "@/components/pitch-console";
import { appConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Saq Bol — пилот экономикасы / экономика пилота", robots: { index: false, follow: false } };
export default function PitchConsolePage() {
  if (appConfig().demoActionsEnabled === false) notFound();
  return <PitchConsole />;
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PitchSite } from "@/components/pitch-site";
import { LocaleProvider } from "@/lib/i18n";
import { appConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Saq Bol — питч беті / питч одной страницей", robots: { index: false, follow: false } };
export default function PitchWebPage() {
  if (appConfig().demoActionsEnabled === false) notFound();
  return <LocaleProvider><PitchSite /></LocaleProvider>;
}

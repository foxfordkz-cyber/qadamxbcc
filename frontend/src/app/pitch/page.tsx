import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PitchSite } from "@/components/pitch-site";
import { LocaleProvider } from "@/lib/i18n";
import { appConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Saq Bol — 5 минуттық питч / питч за 5 минут",
  description: "Аударымды алаяққа жетпей тоқтатамыз: 15 минут кідіріс, қоңырауды тексеру, жақын адам және SOC графы.",
  robots: { index: false, follow: false },
};
export default function PitchPage() {
  if (appConfig().demoActionsEnabled === false) notFound();
  return <LocaleProvider><PitchSite /></LocaleProvider>;
}

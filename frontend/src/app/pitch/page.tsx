import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PitchConsole from "@/components/pitch-console";
import { appConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "BCC Shield — защита проекта / жоба таныстырылымы", robots: { index: false, follow: false } };
export default function PitchPage() {
  if (appConfig().demoActionsEnabled === false) notFound();
  return <PitchConsole />;
}

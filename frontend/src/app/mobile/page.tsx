import type { Metadata, Viewport } from "next";
import ShieldApp from "@/components/shield-app";
import { appConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Saq Bol — телефон",
  appleWebApp: { capable: true, title: "Saq Bol", statusBarStyle: "default" },
};
// resizes-content keeps "Продолжить" above the on-screen keyboard on Android Chrome.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#00AB75", interactiveWidget: "resizes-content" };
export default function MobilePage() { return <ShieldApp config={appConfig()} layout="phone" />; }

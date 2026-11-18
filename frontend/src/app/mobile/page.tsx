import type { Metadata, Viewport } from "next";
import ShieldApp from "@/components/shield-app";
import { appConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "BCC Shield — телефон",
  appleWebApp: { capable: true, title: "BCC Shield", statusBarStyle: "default" },
};
// resizes-content keeps "Продолжить" above the on-screen keyboard on Android Chrome.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#00A859", interactiveWidget: "resizes-content" };
export default function MobilePage() { return <ShieldApp config={appConfig()} layout="phone" />; }

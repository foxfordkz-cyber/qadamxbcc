import ShieldApp from "@/components/shield-app";
import { Landing } from "@/components/landing";
import { LocaleProvider } from "@/lib/i18n";
import { appConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
export default function Page() {
  const config = appConfig();
  if (config.accountMode === "pilot") return <ShieldApp config={config} />;
  return <LocaleProvider><Landing tourEnabled={config.demoActionsEnabled !== false} /></LocaleProvider>;
}

import ShieldApp from "@/components/shield-app";
import { appConfig } from "@/lib/config";

export const dynamic = "force-dynamic";
export default function Page() { return <ShieldApp config={appConfig()} />; }

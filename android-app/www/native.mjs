import { Capacitor, registerPlugin } from "./vendor/capacitor.js";
import { allowedHost } from "./lib.mjs";
const App = registerPlugin("App");
const Browser = registerPlugin("Browser");
export const PUBLIC_DEMO =
  "https://saq-bol-bcc.zerdeliportald.workers.dev/mobile";
export function permittedExternal(url) {
  try {
    const target = new URL(url);
    return (
      url === PUBLIC_DEMO ||
      ((target.protocol === "http:" || target.protocol === "https:") &&
        !target.username &&
        !target.password &&
        allowedHost(target.hostname) &&
        target.pathname === "/mobile" &&
        !target.search &&
        !target.hash)
    );
  } catch {
    return false;
  }
}
export async function openExternal(url) {
  if (!permittedExternal(url)) throw new Error("Destination not allowed");
  // Remote pages do not receive the app's Capacitor bridge or local demo storage.
  if (Capacitor.isNativePlatform())
    await Browser.open({ url, toolbarColor: "#171b35" });
  else window.open(url, "_blank", "noopener,noreferrer");
}
export async function installBackHandler(handler) {
  if (Capacitor.isNativePlatform())
    await App.addListener("backButton", async () => {
      if (!handler()) await App.minimizeApp();
    });
}

export async function installedBuild() {
  if (!Capacitor.isNativePlatform()) return null;
  const {version, build} = await App.getInfo();
  return {version, build};
}

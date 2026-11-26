// Leave the HTML recovery screen available when the installed WebView cannot run the wallet.
if (typeof AbortController === "function" && typeof globalThis.crypto?.getRandomValues === "function") {
  // Apply the saved light/dark choice before the first screen renders.
  void import("./theme-mode.mjs").then(m => { m.loadTheme(); m.loadTextSize(); }).catch(() => {});
  const offline = new URLSearchParams(location.search).get("offline") === "1";
  if (offline) {
    void import("./mobile.mjs");
  } else {
    void import("./connected.mjs");
  }
}

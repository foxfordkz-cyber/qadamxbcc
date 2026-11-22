// Leave the HTML recovery screen available when the installed WebView cannot run the wallet.
if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    && typeof Object.hasOwn === "function" && typeof structuredClone === "function"
    && typeof Array.prototype.at === "function") {
  const offline = new URLSearchParams(location.search).get("offline") === "1";
  if (offline) {
    void import("./mobile.mjs");
  } else {
    void import("./connected.mjs");
  }
}

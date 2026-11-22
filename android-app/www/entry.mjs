// Leave the HTML recovery screen available when the installed WebView cannot run the wallet.
if (typeof AbortController === "function" && typeof TextEncoder === "function"
    && typeof globalThis !== "undefined" && typeof globalThis.crypto?.getRandomValues === "function") {
  const offline = new URLSearchParams(location.search).get("offline") === "1";
  if (offline) {
    void import("./mobile.mjs");
  } else {
    void import("./connected.mjs");
  }
}

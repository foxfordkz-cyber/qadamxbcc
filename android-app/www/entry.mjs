if (new URLSearchParams(location.search).get("offline") === "1") {
  await import("./mobile.mjs");
} else {
  await import("./connected.mjs");
}

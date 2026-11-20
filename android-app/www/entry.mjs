if (new URLSearchParams(location.search).get("offline") === "1") {
  location.replace("demo.html?offline=1");
} else {
  await import("./connected.mjs");
}

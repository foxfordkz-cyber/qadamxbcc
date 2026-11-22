if (new URLSearchParams(location.search).get("offline") === "1") {
  void import("./mobile.mjs");
} else {
  void import("./connected.mjs");
}

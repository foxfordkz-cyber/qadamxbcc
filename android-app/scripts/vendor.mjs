import { mkdir, copyFile } from "node:fs/promises";
await mkdir("www/vendor", { recursive: true });
await copyFile("node_modules/jsqr/dist/jsQR.js", "www/vendor/jsQR.js");
await copyFile(
  "node_modules/@capacitor/core/dist/index.js",
  "www/vendor/capacitor.js",
);

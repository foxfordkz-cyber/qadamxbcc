import { gunzipSync } from "node:zlib";
import { mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
const ocr = "www/vendor/ocr";
await mkdir(ocr, {recursive:true});
for (const [source, file] of [
  ["tesseract.js/dist", "tesseract.min.js"], ["tesseract.js/dist", "worker.min.js"],
  ["tesseract.js/dist", "tesseract.min.js.LICENSE.txt"], ["tesseract.js/dist", "worker.min.js.LICENSE.txt"],
  ["tesseract.js-core", "tesseract-core-lstm.wasm.js"],
  ["tesseract.js", "LICENSE.md"], ["tesseract.js-core", "LICENSE"],

]) await copyFile("node_modules/"+source+"/"+file, ocr+"/"+file);
for (const lang of ["kaz","rus"]) {
  const file = lang+".traineddata";
  const compressed = await readFile("node_modules/@tesseract.js-data/"+lang+"/4.0.0_best_int/"+file+".gz");
  await writeFile(ocr+"/"+file, gunzipSync(compressed));
  await rm(ocr+"/"+file+".gz", {force:true});
}
await mkdir("www/vendor", { recursive: true });
await copyFile("../frontend/src/lib/message-patterns.mjs", "www/vendor/message-patterns.mjs");
await copyFile("node_modules/jsqr/dist/jsQR.js", "www/vendor/jsQR.js");
await copyFile(
  "node_modules/@capacitor/core/dist/index.js",
  "www/vendor/capacitor.js",
);

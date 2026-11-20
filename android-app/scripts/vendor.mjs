import { mkdir, copyFile } from "node:fs/promises";
const ocr = "www/vendor/ocr";
await mkdir(ocr, {recursive:true});
for (const [source, file] of [
  ["tesseract.js/dist", "tesseract.min.js"], ["tesseract.js/dist", "worker.min.js"],
  ["tesseract.js/dist", "tesseract.min.js.LICENSE.txt"], ["tesseract.js/dist", "worker.min.js.LICENSE.txt"],
  ["tesseract.js-core", "tesseract-core-lstm.wasm.js"],
  ["tesseract.js", "LICENSE.md"], ["tesseract.js-core", "LICENSE"],
  ...["kaz","rus"].map(lang => ["@tesseract.js-data/"+lang+"/4.0.0_best_int", lang+".traineddata.gz"])
]) await copyFile("node_modules/"+source+"/"+file, ocr+"/"+file);
await mkdir("www/vendor", { recursive: true });
await copyFile("node_modules/jsqr/dist/jsQR.js", "www/vendor/jsQR.js");
await copyFile(
  "node_modules/@capacitor/core/dist/index.js",
  "www/vendor/capacitor.js",
);

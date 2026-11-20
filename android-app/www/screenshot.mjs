// All OCR assets are included in the APK. The selected image never leaves this device.
export async function readScreenshot(file) {
  if (!file || !["image/png", "image/jpeg"].includes(file.type) || file.size > 8 * 1024 * 1024) throw Error("image_size");
  const bitmap = await createImageBitmap(file);
  let worker;
  try {
    if (bitmap.width * bitmap.height > 16000000) throw Error("image_size");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const assets = new URL("vendor/ocr/", document.baseURI);
    worker = await Tesseract.createWorker(["rus", "kaz"], 1, {
      workerPath: new URL("worker.min.js", assets).href,
      corePath: new URL("tesseract-core-lstm.wasm.js", assets).href,
      langPath: assets.href, workerBlobURL: false, cacheMethod: "none"
    });
    const { data } = await worker.recognize(canvas);
    return data.text.trim().slice(0, 2000);
  } finally {
    bitmap.close();
    if (worker) await worker.terminate();
  }
}


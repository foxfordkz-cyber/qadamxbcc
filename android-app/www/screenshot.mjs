// All OCR assets are included in the APK. The selected image never leaves this device.
// Read dimensions before decoding to bound memory even for compressed, very large images.
async function dimensions(file) {
  const v = new DataView(await file.slice(0, 262144).arrayBuffer());
  if (file.type === "image/png" && v.byteLength >= 24 && v.getUint32(0) === 0x89504e47 &&
      v.getUint32(4) === 0x0d0a1a0a && v.getUint32(12) === 0x49484452) {
    return [v.getUint32(16), v.getUint32(20)];
  }
  if (file.type === "image/jpeg" && v.byteLength > 4 && v.getUint16(0) === 0xffd8) {
    for (let p=2; p+4<v.byteLength;) {
      if (v.getUint8(p++) !== 0xff) break;
      while (p<v.byteLength && v.getUint8(p)===0xff) p++;
      if (p+3>v.byteLength) break;
      const marker=v.getUint8(p++), size=v.getUint16(p);
      if (marker===0xda || marker===0xd9 || size<2) break;
      if ([0xc0,0xc1,0xc2].includes(marker) && size>=7 && p+7<=v.byteLength) {
        return [v.getUint16(p+5), v.getUint16(p+3)];
      }
      p+=size;
    }
  }
  throw Error("image_format");
}
export async function readScreenshot(file) {
  if (!file || !["image/png", "image/jpeg"].includes(file.type) || file.size > 8 * 1024 * 1024) throw Error("image_size");
  const [width,height] = await dimensions(file);
  if (!width || !height || width*height>16000000) throw Error("image_size");
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
    // Android packages uncompressed traineddata files. The same filenames are served
    // by the browser preview and verified in the built APK.
    worker = await Tesseract.createWorker(["rus", "kaz"], 1, {
      workerPath: new URL("worker.min.js", assets).href,
      corePath: new URL("tesseract-core-lstm.wasm.js", assets).href,
      langPath: assets.href, gzip: false, workerBlobURL: false, cacheMethod: "none"
    });
    const { data } = await worker.recognize(canvas);
    return data.text.trim().slice(0, 2000);
  } finally {
    bitmap.close();
    if (worker) await worker.terminate();
  }
}

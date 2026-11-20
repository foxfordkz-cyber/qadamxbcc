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
  let worker, workerUrl;
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
    // Android WebView serves APK resources in the page; dedicated workers cannot fetch
    // that virtual HTTPS origin reliably. Load fixed local files here before spawning.
    const loadAsset = async name => {
      const response = await fetch(new URL(name, assets), {signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw Error("ocr_asset");
      return response;
    };
    const [core, engine, ...languages] = await Promise.all([
      loadAsset("tesseract-core-lstm.wasm.js").then(r=>r.blob()),
      loadAsset("worker.min.js").then(r=>r.blob()),
      ...["rus","kaz"].map(async code => ({
        code, data:new Uint8Array(await (await loadAsset(code+".traineddata")).arrayBuffer())
      }))
    ]);
    workerUrl = URL.createObjectURL(new Blob([core,"\n;\n",engine], {type:"application/javascript"}));
    worker = await Tesseract.createWorker(languages, 1, {
      workerPath:workerUrl, workerBlobURL:false, cacheMethod:"none",
      corePath:new URL("tesseract-core-lstm.wasm.js", assets).href
    });
    const { data } = await worker.recognize(canvas);
    return data.text.trim().slice(0, 2000);
  } finally {
    bitmap.close();
    if (worker) await worker.terminate();
    if (workerUrl) URL.revokeObjectURL(workerUrl);
  }
}


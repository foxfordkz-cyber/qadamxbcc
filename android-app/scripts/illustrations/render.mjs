// Renders the 3D illustrations in models.js to www/img3d/*.webp.
// Usage (from android-app/): npm run illustrations [-- shield phone ...]
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const outDir = path.join(root, "www", "img3d");
const names = process.argv.slice(2);
const types = { ".html": "text/html", ".js": "text/javascript" };
const server = http.createServer(async (req, res) => {
  const file = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://x").pathname));
  try {
    if (!file.startsWith(root)) throw Error("outside");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0, "127.0.0.1");
await new Promise((resolve) => server.on("listening", resolve));
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/scripts/illustrations/render.html`);
  await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
  await mkdir(outDir, { recursive: true });
  const list = names.length ? names : await page.evaluate(async () => Object.keys((await import("/scripts/illustrations/models.js")).models));
  for (const name of list) {
    const url = await page.evaluate((n) => window.render(n), name);
    const bytes = Buffer.from(url.split(",")[1], "base64");
    await writeFile(path.join(outDir, name + ".webp"), bytes);
    console.log(name, bytes.length, "bytes");
  }
} finally {
  await browser.close();
  server.close();
}

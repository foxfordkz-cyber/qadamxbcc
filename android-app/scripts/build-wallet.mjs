import { cp, mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const source = fileURLToPath(new URL("../www/", import.meta.url));
const destination = fileURLToPath(new URL("../../backend/.qadam-web/", import.meta.url));
await mkdir(destination, { recursive: true });
for (const file of await readdir(source, { withFileTypes: true })) {
  if (file.name === "index.html") continue;
  const from = path.join(source, file.name), to = path.join(destination, file.name);
  if (file.isFile() && /\.(mjs|css|svg|html)$/.test(file.name)) {
    // Keep the served text identical to the Linux APK build on Windows checkouts.
    await writeFile(to, (await readFile(from, "utf8")).replace(/\r\n/g, "\n"));
  } else if (file.isDirectory() && file.name === "vendor") {
    await cp(from, to, {recursive: true});
  }
}
const shell = await readFile(path.join(source, "index.html"), "utf8");
const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version.replace(/\.0$/, "");
const apkName = `Qadam-Shield-${version}.apk`;
const install = path.join(destination, "install");
const installer = await stat(path.join(install, apkName)).catch(() => null);
const published = installer?.isFile();
if (published) {
  const date = new Intl.DateTimeFormat("ru-RU", {timeZone:"Asia/Almaty"}).format(installer.mtime);
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../wallet.css"><title>Qadam Shield · Android</title><main class="shell"><section class="paper"><img src="../mark.svg" width="48" alt=""><h1>Qadam Shield ${version}</h1><p>Android · ${date} · Демонстрационная сборка / Демо жинақ</p><p><a download href="${apkName}">Скачать APK / APK жүктеу</a></p><a href="../">Войти в браузере / Браузерде кіру</a></section></main></html>`;
  await writeFile(path.join(install, "index.html"), html);
}
await writeFile(path.join(destination, "index.html"), shell.replace("data-product>", "data-product data-web-wallet"+(published?" data-install":"")+">"));
console.log("Built connected web wallet in backend/.qadam-web/");

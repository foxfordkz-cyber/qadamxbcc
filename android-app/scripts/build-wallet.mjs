import { cp, mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const source = fileURLToPath(new URL("../www/", import.meta.url));
const destination = fileURLToPath(new URL("../../backend/.qadam-web/", import.meta.url));
await mkdir(destination, { recursive: true });
for (const file of await readdir(source, { withFileTypes: true })) {
  if (file.name === "index.html") continue;
  if ((file.isFile() && /\.(mjs|css|svg|html)$/.test(file.name)) ||
      (file.isDirectory() && file.name === "vendor")) {
    await cp(path.join(source, file.name), path.join(destination, file.name), {recursive: true});
  }
}
const shell = await readFile(path.join(source, "index.html"), "utf8");
const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version.replace(/\.0$/, "");
const apkName = `Saq-Bol-Android-${version}.apk`;
const install = path.join(destination, "install");
const published = await stat(path.join(install, apkName)).then(s => s.isFile(), () => false);
if (published) {
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../wallet.css"><title>Saq Bol × BCC · Android</title><main class="shell"><section class="paper"><img src="../mark.svg" width="48" alt=""><h1>Saq Bol × BCC ${version}</h1><p>Android · Демонстрационная сборка / Демо жинақ</p><p><a download href="${apkName}">Скачать APK / APK жүктеу</a></p><a href="../">Войти в браузере / Браузерде кіру</a></section></main></html>`;
  await writeFile(path.join(install, "index.html"), html);
}
await writeFile(path.join(destination, "index.html"), shell.replace("data-product>", "data-product data-web-wallet"+(published?" data-install":"")+">"));
console.log("Built connected web wallet in backend/.qadam-web/");

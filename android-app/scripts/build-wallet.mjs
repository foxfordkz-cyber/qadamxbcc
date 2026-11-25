import { cp, mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

const source = fileURLToPath(new URL("../www/", import.meta.url));
const destination = fileURLToPath(new URL("../../backend/.qadam-web/", import.meta.url));
await mkdir(destination, { recursive: true });
for (const file of await readdir(source, { withFileTypes: true })) {
  if (file.name === "index.html") continue;
  const from = path.join(source, file.name), to = path.join(destination, file.name);
  if (file.isFile() && /\.(mjs|css|svg|html)$/.test(file.name)) {
    // Keep the served text identical to the Linux APK build on Windows checkouts.
    await writeFile(to, (await readFile(from, "utf8")).replace(/\r\n/g, "\n"));
  } else if (file.isDirectory() && ["vendor", "media", "img3d"].includes(file.name)) {
    await cp(from, to, {recursive: true});
  }
}
await cp(path.join(source, "mark.svg"), path.join(destination, "media", "mark.svg"));
const shell = await readFile(path.join(source, "index.html"), "utf8");
const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version.replace(/\.0$/, "");
const apkName = `Saq-Bol-Android-${version}.apk`;
const install = path.join(destination, "install");
const installer = await stat(path.join(install, apkName)).catch(() => null);
const published = installer?.isFile();
if (published) {
  const sha256 = createHash("sha256").update(await readFile(path.join(install, apkName))).digest("hex");
  const recordFile = path.join(install, apkName.replace(/\.apk$/, ".json"));
  const record = await readFile(recordFile, "utf8").then(JSON.parse).catch(e => {
    if (e.code === "ENOENT") return {};
    throw e;
  });
  if (record.apk_sha256 && (record.apk_sha256 !== sha256 || record.version !== version)) {
    throw Error("APK release record does not match the packaged installer");
  }
  const assets = {};
  for (const file of (await readdir(destination)).filter(f => /\.(mjs|css|html|svg)$/.test(f)).sort()) {
    if (file === "index.html") continue;
    assets[file] = createHash("sha256").update(await readFile(path.join(destination, file))).digest("hex");
  }
  await writeFile(path.join(install, "release.json"), JSON.stringify({...record, version, apk: apkName, sha256, bytes: installer.size, assets_scope: "served_web_wallet", assets}, null, 2)+"\n");
  const date = new Intl.DateTimeFormat("ru-RU", {timeZone:"Asia/Almaty"}).format(installer.mtime);
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="../wallet.css"><title>Saq Bol × BCC · Android</title><main class="shell"><section class="paper"><img src="../mark.svg" width="48" alt=""><h1>Saq Bol × BCC ${version}</h1><p>Android · ${date} · Демонстрационная сборка / Демо жинақ</p><p><a download href="${apkName}">Скачать APK / APK жүктеу</a></p><a href="../">Войти в браузере / Браузерде кіру</a></section></main></html>`;
  await writeFile(path.join(install, "index.html"), html.replace("</section>", `<p>SHA-256</p><code style="overflow-wrap:anywhere">${sha256}</code><p><a href="release.json">Release manifest</a></p></section>`));
}
await writeFile(path.join(destination, "index.html"), shell.replace("data-product>", "data-product data-web-wallet"+(published?" data-install":"")+">"));
console.log("Built connected web wallet in backend/.qadam-web/");

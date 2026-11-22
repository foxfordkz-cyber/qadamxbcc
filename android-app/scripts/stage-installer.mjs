import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [packageFile, releases, install, expectedOrigin] = process.argv.slice(2);
if (!packageFile || !releases || !install || !expectedOrigin) {
  throw Error("Usage: stage-installer.mjs <package.json> <releases> <install> <expected-api-origin>");
}

const { version: packageVersion } = JSON.parse(await readFile(packageFile, "utf8"));
if (typeof packageVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(packageVersion)) {
  throw Error("Expected a numeric Android release version in package.json");
}
const version = packageVersion.replace(/\.0$/, "");
const base = `Saq-Bol-Android-${version}`;
const apkName = `${base}.apk`;
const canonical = await readOptional("current.json");
if (canonical !== null) {
  const record = JSON.parse(canonical);
  if (record.version !== version || record.package !== "kz.qadamx.bccshield.demo" ||
      record.api_origin !== expectedOrigin || !/^[a-f0-9]{64}$/.test(record.apk_sha256) ||
      record.url !== "/downloads/Saq-Bol-"+version+"-"+record.apk_sha256.slice(0,12)+".apk") {
    throw Error("Invalid canonical manifest");
  }
  const bytes = await readFile(path.join(releases, path.basename(record.url)));
  if (bytes.length !== record.bytes || createHash("sha256").update(bytes).digest("hex") !== record.apk_sha256) {
    throw Error("Canonical APK mismatch");
  }
  await mkdir(install,{recursive:true});
  await writeFile(path.join(install, apkName),bytes);
  await writeFile(path.join(install, base+".json"),canonical);
  process.exit(0);
}
const apk = await readFile(path.join(releases, apkName));
if (!apk.length) throw Error(`Empty installer: ${apkName}`);
const digest = createHash("sha256").update(apk).digest("hex");

async function readOptional(name) {
  try {
    return await readFile(path.join(releases, name), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const checksum = await readOptional(`${apkName}.sha256`);
const manifest = await readOptional(`${base}.json`);
if (checksum === null && manifest === null) throw Error(`Missing release checksum for ${apkName}`);
if (checksum !== null &&
    ![`${digest}  ${apkName}`, `${digest} *${apkName}`].includes(checksum.trimEnd())) {
  throw Error(`Checksum or filename mismatch in ${apkName}.sha256`);
}
if (manifest !== null) {
  const record = JSON.parse(manifest);
  if (record.version !== version || record.apk_sha256 !== digest ||
      record.api_origin !== expectedOrigin || record.package !== "kz.qadamx.bccshield.demo" ||
      (record.apk !== undefined && record.apk !== apkName)) {
    throw Error(`Release metadata mismatch for ${apkName}`);
  }
}

await mkdir(install, { recursive: true });
await writeFile(path.join(install, apkName), apk);
await writeFile(path.join(install, `${apkName}.sha256`), `${digest}  ${apkName}\n`);
if (manifest !== null) await writeFile(path.join(install, `${base}.json`), manifest);
console.log(`Staged ${apkName} (SHA-256 ${digest})`);

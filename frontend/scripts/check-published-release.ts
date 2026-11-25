import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { assertReleaseOrder, releaseIdentity } from "./release-guard";

async function main() {
  const local = JSON.parse(await readFile("public/downloads/current.json", "utf8"));
  const alias = JSON.parse(await readFile("public/downloads/team.json", "utf8"));
  const identity = releaseIdentity(local);
  if (JSON.stringify(local) !== JSON.stringify(alias)) throw new Error("current/team manifests differ");
  if (typeof local.url !== "string" || !/^\/downloads\/[A-Za-z0-9._-]+\.apk$/.test(local.url)) {
    throw new Error("APK must be a local downloads asset");
  }
  const apk = await readFile("public" + local.url);
  if (apk.byteLength !== local.bytes || createHash("sha256").update(apk).digest("hex") !== identity.apk_sha256) {
    throw new Error("Local APK bytes do not match the manifest");
  }
  for (const name of ["current", "team"]) {
    const built = JSON.parse(await readFile(`dist/client/downloads/${name}.json`, "utf8"));
    if (JSON.stringify(built) !== JSON.stringify(local)) throw new Error("Built release is stale; rebuild Cloudflare first");
  }
  const builtApk = await readFile("dist/client" + local.url);
  if (builtApk.byteLength !== local.bytes || createHash("sha256").update(builtApk).digest("hex") !== identity.apk_sha256) {
    throw new Error("Built APK bytes do not match the manifest");
  }
  const response = await fetch("https://saq-bol-bcc.zerdeliportald.workers.dev/downloads/current.json", {
    headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000), cache: "no-store",
  });
  if (!response.ok) throw new Error("Cannot verify published release: HTTP " + response.status);
  const published = releaseIdentity(await response.json());
  assertReleaseOrder(identity, published);
  console.log(`Release guard PASS: published ${published.versionCode}, local ${identity.versionCode}; APK hash verified`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Release verification failed");
  process.exitCode = 1;
});

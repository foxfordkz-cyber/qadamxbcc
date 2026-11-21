import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/stage-installer.mjs", import.meta.url));
const origin = "https://saq-bol-mobile.onrender.com";
const bytes = Buffer.from("release fixture");
const digest = createHash("sha256").update(bytes).digest("hex");

async function release(t, version) {
  const dir = await mkdtemp(path.join(tmpdir(), "saq-installer-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const base = `Saq-Bol-Android-${version}`;
  const apk = `${base}.apk`;
  const install = path.join(dir, "install");
  const pkg = path.join(dir, "package.json");
  await writeFile(pkg, JSON.stringify({ version: `${version}.0` }));
  await writeFile(path.join(dir, apk), bytes);
  const record = { version, package: "kz.qadamx.bccshield.demo", apk_sha256: digest, api_origin: origin };
  return {
    dir, apk, install, record,
    checksum: path.join(dir, `${apk}.sha256`),
    manifest: path.join(dir, `${base}.json`),
    stage: () => spawnSync(process.execPath, [script, pkg, dir, install, origin], { encoding: "utf8" }),
  };
}

test("stages only the selected legacy APK and its verified sidecar", async t => {
  const f = await release(t, "2.6");
  await writeFile(path.join(f.dir, "Saq-Bol-Android-2.5.apk"), "archived");
  await writeFile(f.checksum, `${digest}  ${f.apk}\r\n`);
  const result = f.stage();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readdir(f.install)).sort(), [f.apk, `${f.apk}.sha256`]);
  assert.deepEqual(await readFile(path.join(f.install, f.apk)), bytes);
});

test("stages a manifest-backed release and preserves its metadata", async t => {
  const f = await release(t, "2.7");
  await writeFile(f.manifest, JSON.stringify(f.record));
  const result = f.stage();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.install, path.basename(f.manifest)), "utf8")), f.record);
  assert.equal(await readFile(path.join(f.install, `${f.apk}.sha256`), "utf8"), `${digest}  ${f.apk}\n`);
});

test("rejects missing artifacts and mismatches in either release record", async t => {
  const f = await release(t, "2.7");
  function rejects(message) {
    const result = f.stage();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  }
  rejects(/Missing release checksum/);
  await writeFile(f.manifest, JSON.stringify(f.record));
  await writeFile(f.checksum, `${digest}  another.apk\n`);
  rejects(/filename mismatch/);
  await writeFile(f.checksum, `${digest}  ${f.apk}\n`);
  for (const field of ["version", "apk_sha256", "api_origin", "package", "apk"]) {
    await writeFile(f.manifest, JSON.stringify({ ...f.record, [field]: "inconsistent" }));
    rejects(/metadata mismatch/);
  }
  await writeFile(f.manifest, JSON.stringify(f.record));
  await writeFile(path.join(f.dir, f.apk), "changed after signing");
  rejects(/Checksum or filename mismatch/);
  await rm(path.join(f.dir, f.apk));
  rejects(/ENOENT/);
  await assert.rejects(readdir(f.install), { code: "ENOENT" });
});

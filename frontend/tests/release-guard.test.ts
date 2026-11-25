import assert from "node:assert/strict";
import test from "node:test";
import { assertReleaseOrder, releaseIdentity } from "../scripts/release-guard";

const release = { versionCode: 24, apk_sha256: "a".repeat(64), package: "kz.qadamx.bccshield.demo", certificate_sha256: "b".repeat(64) };
test("a website update cannot roll the public Android release backwards", () => {
  assert.throws(() => assertReleaseOrder({ ...release, versionCode: 22 }, release), /downgrade/);
});
test("different bytes cannot silently reuse a published Android version", () => {
  assert.throws(() => assertReleaseOrder({ ...release, apk_sha256: "c".repeat(64) }, release), /new Android versionCode/);
});
test("release verification rejects malformed or incompatible signing identities", () => {
  assert.throws(() => releaseIdentity({ ...release, versionCode: "24" }), /Invalid/);
  assert.throws(() => releaseIdentity({ ...release, apk_sha256: "missing" }), /Invalid/);
  assert.throws(() => assertReleaseOrder({ ...release, package: "other" }, release), /identity/);
  assert.throws(() => assertReleaseOrder({ ...release, certificate_sha256: "c".repeat(64) }, release), /identity/);
});
test("an unchanged release or a newer signed build can accompany a website update", () => {
  assert.doesNotThrow(() => assertReleaseOrder(releaseIdentity(release), release));
  assert.doesNotThrow(() => assertReleaseOrder({ ...release, versionCode: 25, apk_sha256: "c".repeat(64) }, release));
});

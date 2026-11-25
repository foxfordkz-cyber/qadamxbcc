export type ReleaseIdentity = {
  versionCode: number;
  apk_sha256: string;
  package: string;
  certificate_sha256: string;
};

export function releaseIdentity(value: unknown): ReleaseIdentity {
  if (!value || typeof value !== "object") throw new Error("Missing release manifest");
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.versionCode) || Number(row.versionCode) < 1 ||
      typeof row.package !== "string" || !row.package ||
      typeof row.apk_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.apk_sha256) ||
      typeof row.certificate_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.certificate_sha256)) {
    throw new Error("Invalid release identity");
  }
  return row as ReleaseIdentity;
}

export function assertReleaseOrder(local: ReleaseIdentity, published: ReleaseIdentity): void {
  if (local.package !== published.package || local.certificate_sha256 !== published.certificate_sha256) {
    throw new Error("Published package or signing identity would change");
  }
  if (local.versionCode < published.versionCode) throw new Error("Refusing an Android release downgrade");
  if (local.versionCode === published.versionCode && local.apk_sha256 !== published.apk_sha256) {
    throw new Error("A different APK requires a new Android versionCode");
  }
}

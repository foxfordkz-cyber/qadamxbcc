"""Verify both APKs against their signed identities and recorded source revisions."""
import argparse
from pathlib import Path

from release_tools import API, CHANNELS, DOWNLOADS, filename, inspect_apk, read_record, sha256, verify_source


def verify(channel, signer):
    manifest, historical = CHANNELS[channel]
    record = read_record(DOWNLOADS / manifest)
    accepted = read_record(historical)
    name = filename(record["version"], record["apk_sha256"])
    apk = DOWNLOADS / name
    if (record["url"] != "/downloads/" + name or record["api_origin"] != API
            or record["package"] != accepted["package"]
            or record["certificate_sha256"] != accepted["certificate_sha256"]
            or record["versionCode"] <= accepted["versionCode"]):
        raise ValueError(f"Invalid {channel} release record")
    if apk.stat().st_size != record["bytes"] or sha256(apk) != record["apk_sha256"]:
        raise ValueError(f"{channel} APK size or SHA-256 differs from the release record")
    count = verify_source(apk, record["source_commit"], record["version"])
    if signer:
        for key, value in inspect_apk(apk, signer, channel).items():
            if record[key] != value:
                raise ValueError(f"{channel} APK {key} differs from the release record")
    print(f"{channel}: {record['package']} {record['version']} build {record['versionCode']}, "
          f"SHA-256 and {count} UI files match {record['source_commit']}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apksigner", type=Path, help="Android SDK apksigner to validate the signature and manifest")
    args = parser.parse_args()
    for channel in CHANNELS:
        verify(channel, args.apksigner)
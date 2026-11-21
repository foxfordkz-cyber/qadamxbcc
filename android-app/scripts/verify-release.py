"""Verify the packaged Android wallet against the source revision recorded at signing."""

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[2]
WEB_TYPES = {".html", ".css", ".mjs", ".svg"}


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)


def verify(apksigner: str | None) -> None:
    version = json.loads((ROOT / "android-app/package.json").read_bytes())["version"].removesuffix(".0")
    if not re.fullmatch(r"\d+(?:\.\d+){1,2}", version):
        raise ValueError("Invalid release version")
    base = ROOT / "deliverables/android" / f"Saq-Bol-Android-{version}"
    apk = base.parent / (base.name + ".apk")
    record = json.loads((base.parent / (base.name + ".json")).read_bytes())
    source = record["apk_source_commit"]
    if record["version"] != version or not re.fullmatch(r"[0-9a-f]{40}", source):
        raise ValueError("Invalid release record")
    if hashlib.sha256(apk.read_bytes()).hexdigest() != record["apk_sha256"]:
        raise ValueError("Packaged APK digest differs from the release record")
    tree = source + ":android-app/www"
    files = {
        name for name in git("ls-tree", "--name-only", tree).decode().splitlines()
        if Path(name).suffix in WEB_TYPES
    }
    with ZipFile(apk) as archive:
        prefix = "assets/public/"
        packed = {
            path.removeprefix(prefix) for path in archive.namelist()
            if path.startswith(prefix) and path.count("/") == 2 and Path(path).suffix in WEB_TYPES
        }
        if packed != files or "index.html" not in files:
            raise ValueError("Packaged UI files differ from the signed source tree")
        for name in sorted(files):
            original = git("show", source + ":android-app/www/" + name)
            if archive.read(prefix + name).replace(b"\r\n", b"\n") != original.replace(b"\r\n", b"\n"):
                raise ValueError(f"Packaged UI differs from signed source: {name}")
    if apksigner:
        result = subprocess.check_output([apksigner, "verify", "--print-certs", str(apk)], text=True)
        digests = re.findall(r"^Signer #\d+ certificate SHA-256 digest:\s*([0-9a-fA-F]{64})\s*$", result, re.M)
        if not digests:
            raise ValueError("apksigner verified the APK but returned no signing certificate digest")
        if [value.lower() for value in digests] != [record["certificate_sha256"]]:
            raise ValueError(f"Unexpected Android signing certificate fingerprints: {digests}")
        print("Android signature and certificate match the release record.")
    print(f"APK {version}: SHA-256 and all {len(files)} UI files verified against {source}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apksigner", help="Android SDK apksigner executable to verify the signature")
    verify(parser.parse_args().apksigner)

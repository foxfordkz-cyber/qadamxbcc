"""Shared checks for the two independently signed Android distribution channels."""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
DOWNLOADS = ROOT / "frontend/public/downloads"
API = "https://saq-bol-mobile.onrender.com"
STAGING_API = "https://saq-bol-mobile-staging.onrender.com"
CHANNELS = {
    "website": ("legacy-website-2.9.json", DOWNLOADS / "Saq-Bol-Android-2.7.json"),
    "team": ("current.json", ROOT / "deliverables/android/Saq-Bol-Android-2.7.json"),
}
WEB_TYPES = {".html", ".css", ".mjs", ".svg"}


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def read_record(path):
    return json.loads(path.read_bytes())


def get_tool(directory, name):
    ext = {"apksigner": ".bat", "aapt": ".exe"}[name] if os.name == "nt" else ""
    return directory / (name + ext)


def inspect_apk(apk, signer, channel, *, staging_candidate=False):
    # Publication callers keep the canonical origin. Only the explicit candidate
    # verifier accepts the separately authorized staging, never an arbitrary host.
    expected_api = STAGING_API if staging_candidate else API
    def run(path, *args):
        return subprocess.check_output([str(path), *args, str(apk.resolve())], encoding="utf-8")

    accepted = read_record(CHANNELS[channel][1])
    result = run(signer, "verify", "--print-certs")
    fingerprints = re.findall(r"^Signer #\d+ certificate SHA-256 digest:\s*([0-9a-f]{64})\s*$", result, re.M)
    if fingerprints != [accepted["certificate_sha256"]]:
        raise ValueError(f"Signing certificate differs from the historical {channel} package")
    aapt = get_tool(Path(signer).parent, "aapt")
    badging = run(aapt, "dump", "badging")
    identity = re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([\d.]+)'", badging, re.M)
    sdk = re.search(r"^sdkVersion:'(\d+)'", badging, re.M)
    if not identity or not sdk or identity[1] != accepted["package"] or "application-debuggable" in badging:
        raise ValueError(f"Unexpected Android manifest for the {channel} package")
    resources = run(aapt, "dump", "--values", "resources")
    origins = re.findall(r'^\s*resource [^\n]+:string/qadam_api_origin:[^\n]*\n\s*\(string8\) "([^"]+)"', resources, re.M)
    if set(origins) != {expected_api}:
        raise ValueError("Unexpected Android API origin")
    return dict(package=identity[1], versionCode=int(identity[2]), version=identity[3],
                minSdk=int(sdk[1]), certificate_sha256=fingerprints[0], api_origin=expected_api)


def verify_source(apk, source, version):
    if not re.fullmatch(r"[a-f0-9]{40}", source):
        raise ValueError("Expected a full source commit")
    pkg = json.loads(git("show", source + ":android-app/package.json"))
    if pkg["version"].removesuffix(".0") != version:
        raise ValueError("Packaged version differs from the source revision")
    tree = source + ":android-app/www"
    files = {name for name in git("ls-tree", "--name-only", tree).decode().splitlines()
             if Path(name).suffix in WEB_TYPES}
    prefix = "assets/public/"
    with ZipFile(apk) as archive:
        packed = {path.removeprefix(prefix) for path in archive.namelist()
                  if path.startswith(prefix) and path.count("/") == 2 and Path(path).suffix in WEB_TYPES}
        if packed != files or "index.html" not in files:
            raise ValueError("Packaged UI files differ from the source tree")
        for name in sorted(files):
            original = git("show", tree + "/" + name)
            if archive.read(prefix + name).replace(b"\r\n", b"\n") != original.replace(b"\r\n", b"\n"):
                raise ValueError(f"Packaged UI differs from source: {name}")
    return len(files)


def filename(version, digest):
    if not re.fullmatch(r"\d+(?:\.\d+){1,2}", version) or not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("Invalid release version or SHA-256")
    return f"Saq-Bol-{version}-{digest[:12]}.apk"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

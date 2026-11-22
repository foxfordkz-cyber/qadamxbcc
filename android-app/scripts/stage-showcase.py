"""Stage a signed showcase and its download page together, before deploying the site."""
import argparse
import hashlib
import json
import os
import re
import subprocess
from datetime import date
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = "kz.qadamx.bccshield.demo"
API = "https://saq-bol-mobile.onrender.com"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--sdk-tools", type=Path, required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--date", type=date.fromisoformat, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.source):
        parser.error("Source must be a full commit")
    tools = args.sdk_tools
    def run(*cmd):
        return subprocess.check_output(cmd, cwd=ROOT).decode("utf8", "replace")
    signer = tools / ("apksigner.bat" if os.name == "nt" else "apksigner")
    aapt = tools / ("aapt.exe" if os.name == "nt" else "aapt")
    signature = run(str(signer), "verify", "--print-certs", str(args.apk.resolve()))
    accepted = json.loads((ROOT/"deliverables/android/Saq-Bol-Android-2.7.json").read_bytes())
    cert = accepted["certificate_sha256"]
    if re.findall(r"Signer #\d+ certificate SHA-256 digest: (\w+)", signature) != [cert]:
        parser.error("Signer differs from accepted .demo identity")
    manifest = run(str(aapt), "dump", "badging", str(args.apk.resolve()))
    pkg, code, version = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([\d.]+)'", manifest).groups()
    if pkg != PACKAGE or "application-debuggable" in manifest:
        parser.error("Expected a non-debuggable .demo showcase")
    sdk = int(re.search(r"sdkVersion:'(\d+)'", manifest)[1])
    resources = run(str(aapt), "dump", "--values", "resources", str(args.apk.resolve()))
    if not re.search(r"string/qadam_api_origin[^\n]*\n(?:[^\n]*\n){0,2}[^\n]*"+re.escape(API)+r'"', resources):
        parser.error("Unexpected API origin")
    tree = args.source + ":android-app/www"
    names = run("git", "ls-tree", "--name-only", tree).splitlines()
    with ZipFile(args.apk) as archive:
        for name in names:
            if Path(name).suffix not in {".html",".css",".svg",".mjs"}:
                continue
            source = subprocess.check_output(["git","show",tree+"/"+name],cwd=ROOT)
            if archive.read("assets/public/"+name).replace(b"\r\n",b"\n") != source.replace(b"\r\n",b"\n"):
                parser.error("Source mismatch: "+name)
    data = args.apk.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    name = f"Saq-Bol-{version}-{digest[:12]}.apk"
    public = ROOT/"frontend/public"
    output = public/"downloads"/name
    output.parent.mkdir(exist_ok=True)
    output.write_bytes(data)
    record = dict(version=version, versionCode=int(code), package=pkg, minSdk=sdk,
                  certificate_sha256=cert, apk_sha256=digest, bytes=len(data), date=str(args.date),
                  url="/downloads/"+name, api_origin=API, source_commit=args.source)
    path = public/"downloads/current.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(record, indent=2)+"\n", encoding="utf8")
    tmp.replace(path)
    print(name, digest)


if __name__ == "__main__":
    main()


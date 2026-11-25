"""Stage a verified Android APK in its existing distribution channel."""
import argparse
import json
from datetime import date
from pathlib import Path
from shutil import copyfile

from release_tools import CHANNELS, DOWNLOADS, filename, get_tool, inspect_apk, read_record, sha256, verify_source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--channel", choices=["team"], default="team")
    parser.add_argument("--sdk-tools", type=Path, required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--date", type=date.fromisoformat, required=True)
    args = parser.parse_args()
    record = inspect_apk(args.apk, get_tool(args.sdk_tools, "apksigner"), args.channel)
    verify_source(args.apk, args.source, record["version"])
    digest = sha256(args.apk)
    name = filename(record["version"], digest)
    manifest, historical = CHANNELS[args.channel]
    path = DOWNLOADS / manifest
    prior = read_record(path) if path.exists() else read_record(historical)
    if prior["package"] != record["package"]:
        prior = read_record(DOWNLOADS / "team.json")
        if prior["package"] != record["package"]:
            parser.error("Incompatible team release baseline")
    if record["versionCode"] < prior["versionCode"] or (record["versionCode"] == prior["versionCode"]
                                                       and digest != prior["apk_sha256"]):
        parser.error("Increment the Android versionCode for a new build")
    record.update(apk_sha256=digest, bytes=args.apk.stat().st_size, date=str(args.date),
                  url="/downloads/" + name, source_commit=args.source)
    dest = DOWNLOADS / name
    if dest.exists():
        if sha256(dest) != digest:
            parser.error("A different APK already exists at the target URL")
    else:
        copyfile(args.apk, dest.with_suffix(".tmp"))
        dest.with_suffix(".tmp").replace(dest)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(record, indent=2) + "\n", encoding="utf8")
    tmp.replace(path)
    # Older tools still fetch this URL. Deploy both files in the same site revision.
    alias = DOWNLOADS / "team.json"
    copyfile(path, alias.with_suffix(".tmp"))
    alias.with_suffix(".tmp").replace(alias)
    print(name, digest)


if __name__ == "__main__":
    main()
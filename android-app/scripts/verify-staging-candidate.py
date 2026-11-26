"""Inspect a staging candidate without altering any public release manifest."""
import argparse
import json
from pathlib import Path

from release_tools import get_tool, inspect_apk, sha256, verify_source

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("apk", type=Path)
parser.add_argument("--sdk-tools", type=Path, required=True)
parser.add_argument("--source", required=True)
args = parser.parse_args()
record = inspect_apk(args.apk, get_tool(args.sdk_tools, "apksigner"), "team", staging_candidate=True)
if record["versionCode"] < 26:
    raise ValueError("Staging candidate must supersede the unaccepted build 25")
record.update(source_commit=args.source, apk_sha256=sha256(args.apk), bytes=args.apk.stat().st_size,
              publication="NOT_ACCEPTED", verified_ui_files=verify_source(args.apk, args.source, record["version"]))
print(json.dumps(record, indent=2))

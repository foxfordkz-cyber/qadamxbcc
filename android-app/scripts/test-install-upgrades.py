"""Test Android update compatibility on an empty, dedicated emulator."""
import argparse
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOWNLOADS = ROOT / "frontend/public/downloads"


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--serial", required=True)
    serial = args.parse_args().serial
    if not re.fullmatch(r"emulator-\d+", serial):
        args.error("Use a dedicated emulator for the upgrade test")

    def adb(*cmd):
        return subprocess.check_output(["adb", "-s", serial, *map(str, cmd)], text=True, timeout=120).strip()

    def install(apk):
        if adb("install", "-r", apk).splitlines()[-1] != "Success":
            raise ValueError(f"Android did not install {apk.name}")

    def identity(package, code):
        dump = adb("shell", "dumpsys", "package", package)
        if not re.search(rf"\bversionCode={code}\b", dump):
            raise ValueError(f"Expected {package} build {code}")
        uid = re.search(r"\buid:(\d+)", adb("shell", "pm", "list", "packages", "-U", package))
        first = re.search(r"firstInstallTime=([^\r\n]+)", dump)
        if not uid or not first:
            raise ValueError(f"Missing UID or install timestamp for {package}")
        return uid[1], first[1].strip()

    adb("shell", "wm", "dismiss-keyguard")
    for channel, manifest, archive in [
        ("website", "current.json", DOWNLOADS / "Saq-Bol-Android-2.7.apk"),
        ("team", "team.json", ROOT / "deliverables/android/Saq-Bol-Android-2.7.apk"),
    ]:
        old = json.loads(archive.with_suffix(".json").read_bytes())
        new = json.loads((DOWNLOADS / manifest).read_bytes())
        package = old["package"]
        if adb("shell", "pm", "list", "packages", package):
            raise ValueError(f"Start with a fresh emulator. {package} is already installed.")
        if new["package"] != package or old["versionCode"] >= new["versionCode"]:
            raise ValueError(f"Invalid upgrade manifest for {channel}")
        install(archive)
        before = identity(package, old["versionCode"])
        install(DOWNLOADS / Path(new["url"]).name)
        if identity(package, new["versionCode"]) != before:
            raise ValueError(f"Android did not preserve the {channel} installation")
        activity = adb("shell", "cmd", "package", "resolve-activity", "--brief", package).splitlines()[-1]
        if not activity.startswith(package + "/"):
            raise ValueError(f"Missing {channel} launcher activity")
        opened = adb("shell", "am", "start", "-W", "-n", activity)
        if "Status: ok" not in opened:
            raise ValueError(f"Could not launch {activity}")
        print(f"{channel}: {old['version']} ({old['versionCode']}) → {new['version']} ({new['versionCode']}). "
              "UID and first-install time preserved. Launcher opened.", flush=True)


if __name__ == "__main__":
    main()
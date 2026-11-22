"""Test Android update compatibility on an empty, dedicated emulator."""
import argparse
import hashlib
import json
import re
import subprocess
import time
from tempfile import TemporaryDirectory
from xml.etree import ElementTree
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOWNLOADS = ROOT / "frontend/public/downloads"


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--serial", required=True)
    args.add_argument("--evidence-dir", type=Path, required=True)
    options = args.parse_args()
    serial = options.serial
    options.evidence_dir.mkdir(parents=True, exist_ok=True)
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

    def launch(package):
        activity = adb("shell", "cmd", "package", "resolve-activity", "--brief", package).splitlines()[-1]
        if not activity.startswith(package + "/"):
            raise ValueError(f"Missing {package} launcher activity")
        if "Status: ok" not in adb("shell", "am", "start", "-W", "-n", activity):
            raise ValueError(f"Could not launch {activity}")

    def verify_clean_install(package, channel, apk, record):
        install(apk)
        identity(package, record["versionCode"])
        installed = adb("shell", "pm", "path", package).removeprefix("package:")
        with TemporaryDirectory() as tmp:
            pulled = Path(tmp) / "installed.apk"
            adb("pull", installed, pulled)
            if hashlib.sha256(pulled.read_bytes()).hexdigest() != record["apk_sha256"]:
                raise ValueError(f"Installed bytes differ from the {channel} release")
        launch(package)
        for _ in range(20):
            adb("shell", "uiautomator", "dump", "/sdcard/window.xml")
            tree = ElementTree.fromstring(adb("exec-out", "cat", "/sdcard/window.xml"))
            if any(node.get("class") == "android.widget.EditText" and node.get("package") == package
                   for node in tree.iter("node")):
                png = subprocess.check_output(["adb", "-s", serial, "exec-out", "screencap", "-p"], timeout=30)
                if not png.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise ValueError("Expected a PNG screenshot")
                (options.evidence_dir / f"{channel}-login.png").write_bytes(png)
                break
            time.sleep(2)
        else:
            raise ValueError(f"The login form did not appear in {package}")
        # This package was installed above on a fresh, dedicated CI emulator.
        if adb("uninstall", package) != "Success":
            raise ValueError(f"Could not prepare {package} for the upgrade test")

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
        current = DOWNLOADS / Path(new["url"]).name
        verify_clean_install(package, channel, current, new)
        install(archive)
        before = identity(package, old["versionCode"])
        install(current)
        if identity(package, new["versionCode"]) != before:
            raise ValueError(f"Android did not preserve the {channel} installation")
        launch(package)
        print(f"{channel}: {old['version']} ({old['versionCode']}) → {new['version']} ({new['versionCode']}). "
              "UID and first-install time preserved. Launcher opened.", flush=True)


if __name__ == "__main__":
    main()

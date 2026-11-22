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
    args.add_argument("--legacy-system-image", action="store_true",
                      help="Record the factory WebView on the Android 11 image and test package upgrades.")
    options = args.parse_args()
    serial = options.serial
    options.evidence_dir.mkdir(parents=True, exist_ok=True)
    if not re.fullmatch(r"emulator-\d+", serial):
        args.error("Use a dedicated emulator for the upgrade test")

    def adb(*cmd):
        return subprocess.check_output(["adb", "-s", serial, *map(str, cmd)], encoding="utf-8", timeout=180).strip()

    def install(apk):
        if adb("install", "--no-streaming", "-r", apk).splitlines()[-1] != "Success":
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
        result = adb("shell", "am", "start", "-W", "-n", activity)
        if "Status: ok" in result:
            return
        if "Status: timeout" in result:
            # A slow first WebView draw can outlast Activity Manager's wait.
            # Confirm the resumed activity in Android before testing its UI.
            for _ in range(10):
                state = adb("shell", "dumpsys", "activity", "activities")
                if re.search(r"(?:topResumedActivity|mResumedActivity)[^\n]*" + re.escape(activity), state):
                    return
                time.sleep(1)
        raise ValueError(f"Could not launch {activity}: {result}")

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
        login_visible = False
        fallback_visible = False
        for _ in range(3 if legacy_webview else 20):
            dump = adb("shell", "uiautomator", "dump", "/sdcard/window.xml")
            if "dumped" not in dump.lower():
                time.sleep(2)
                continue
            layout = adb("exec-out", "cat", "/sdcard/window.xml")
            (options.evidence_dir / f"{channel}-screen.xml").write_text(layout, encoding="utf-8")
            tree = ElementTree.fromstring(layout)
            if any(node.get("class") == "android.widget.EditText" and node.get("package") == package
                   for node in tree.iter("node")):
                login_visible = True
                break
            if legacy_webview and channel == "website":
                fallback_visible = any(
                    "Android System WebView" in (node.get("text", "") + node.get("content-desc", ""))
                    for node in tree.iter("node") if node.get("package") == package
                )
                if fallback_visible:
                    break
            time.sleep(2)
        else:
            screenshot(channel + ("-legacy-webview" if legacy_webview else "-unexpected"))
            if not legacy_webview or channel == "website":
                raise ValueError(f"The login form did not appear in {package}")
            print(f"{channel}: login form unavailable in factory WebView {major}.", flush=True)
        if login_visible:
            screenshot(channel + "-login")
        elif fallback_visible:
            screenshot(channel + "-update-webview")
            print(f"{channel}: WebView update instructions visible on version {major}.", flush=True)
        # This package was installed above on a fresh, dedicated CI emulator.
        if adb("uninstall", package) != "Success":
            raise ValueError(f"Could not prepare {package} for the upgrade test")

    def screenshot(name):
        png = subprocess.check_output(["adb", "-s", serial, "exec-out", "screencap", "-p"], timeout=30)
        if not png.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Expected a PNG screenshot")
        (options.evidence_dir / f"{name}.png").write_bytes(png)

    provider = adb("shell", "dumpsys", "webviewupdate")
    print(provider, flush=True)
    package_info = re.search(r"Current WebView package \(name, version\):\s*\([^,]+,\s*(\d+)\.", provider)
    if not package_info:
        raise ValueError("Could not read the active WebView provider")
    major = int(package_info[1])
    legacy_webview = options.legacy_system_image and major < 103
    if major < 103 and not legacy_webview:
        raise ValueError(f"The wallet HTTP client requires WebView 103+, found {major}")
    adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
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

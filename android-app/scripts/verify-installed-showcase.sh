#!/usr/bin/env bash
set -euo pipefail
manifest=frontend/public/downloads/team.json
apk="frontend/public$(jq -r .url "$manifest")"
pkg=$(jq -r .package "$manifest")
expected=$(jq -r .apk_sha256 "$manifest")
echo "$expected  $apk" | sha256sum -c -
phone=(adb -e)
test -z "$("${phone[@]}" shell pm list packages "$pkg" | tr -d '\r')"
"${phone[@]}" install "$apk"
base=$("${phone[@]}" shell pm path "$pkg" | tr -d '\r' | sed -n 's/^package://p' | head -1)
"${phone[@]}" pull "$base" "$RUNNER_TEMP/installed.apk"
echo "$expected  $RUNNER_TEMP/installed.apk" | sha256sum -c -
"${phone[@]}" shell am start -W -n "$pkg/kz.qadamx.bccshield.MainActivity"
for i in {1..20}; do
  "${phone[@]}" shell uiautomator dump /sdcard/window.xml >/dev/null || continue
  "${phone[@]}" exec-out cat /sdcard/window.xml > "$RUNNER_TEMP/window.xml"
  if grep -q 'class="android.widget.EditText"' "$RUNNER_TEMP/window.xml" && grep -q "package=\"$pkg\"" "$RUNNER_TEMP/window.xml"; then
    "${phone[@]}" exec-out screencap -p > "$RUNNER_TEMP/showcase-login.png"
    exit 0
  fi
  sleep 2
done
exit 1

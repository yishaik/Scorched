#!/usr/bin/env bash
# Android emulator smoke test for the debug APK (throwaway AGP debug key, never released).
# Runs inside reactivecircus/android-emulator-runner in CI; also works against any adb device you choose.
# Usage: tests/android/emulator-smoke.sh <app-debug.apk> [out-dir]
# Fails on: install/launch failure, app process gone, FATAL EXCEPTION or ANR in the app, chromium "Uncaught" console
# errors, a WebView that never renders the game, lost app data after reinstall-over, or a failed CDP game round.
# The emulator's network is switched off first, so nothing (deep-link joins, fonts) can reach production.
set -uo pipefail
APK="${1:?usage: emulator-smoke.sh <apk> [out-dir]}"
OUT="${2:-android-artifacts}"
PKG=com.yishai.scorchedtanks
ACT="$PKG/.MainActivity"
CDP_PORT="${CDP_PORT:-9222}"
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$OUT"
FAILS=()
log() { printf '\n== %s\n' "$*"; }
fail() { echo "FAIL: $*" >&2; FAILS+=("$*"); }
shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null || true; }
alive() { adb shell pidof "$PKG" >/dev/null 2>&1; }
api="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
echo "device API $api"
adb shell dumpsys package com.google.android.webview 2>/dev/null | grep -m1 versionName | tee "$OUT/webview-version.txt" || true
adb shell dumpsys package com.android.webview 2>/dev/null | grep -m1 versionName | tee -a "$OUT/webview-version.txt" || true
adb shell dumpsys package com.android.chrome 2>/dev/null | grep -m1 versionName | sed 's/^/chrome /' | tee -a "$OUT/webview-version.txt" || true

# Android 7-9 can use the Chrome app as the WebView provider (that is how real devices get WebView updates from
# Play). The stock API 24 image ships Android System WebView 53, older than real updated devices; use the newer
# installed Chrome as provider when there is one, and record which provider ran the test.
if [ "$api" -lt 29 ] && adb shell pm list packages 2>/dev/null | tr -d '\r' | grep -qx "package:com.android.chrome"; then
  adb shell cmd webviewupdate set-webview-implementation com.android.chrome 2>&1 | tee -a "$OUT/webview-version.txt" || true
fi
adb shell dumpsys webviewupdate 2>/dev/null | tr -d '\r' | grep -iE "current webview package|webview package \(name" | tee -a "$OUT/webview-version.txt" || true

log "offline: wifi and mobile data off (no production traffic)"
adb shell svc wifi disable || true
adb shell svc data disable || true

cdp_forward() {
  local pid sock
  pid="$(adb shell pidof "$PKG" | tr -d '\r' | awk '{print $1}')"
  [ -n "$pid" ] || return 1
  for _ in $(seq 1 20); do
    sock="$(adb shell cat /proc/net/unix 2>/dev/null | tr -d '\r' | grep -o "webview_devtools_remote_$pid" | head -n1)"
    [ -n "$sock" ] && break
    sleep 1
  done
  [ -n "$sock" ] || return 1
  adb forward --remove "tcp:$CDP_PORT" >/dev/null 2>&1 || true
  adb forward "tcp:$CDP_PORT" "localabstract:$sock" >/dev/null
}
cdp() { node "$HERE/webview-cdp.mjs" "$CDP_PORT" "$@"; }

launch() {
  adb shell am start -W -n "$ACT" | tee -a "$OUT/am.txt"
  for _ in $(seq 1 30); do alive && break; sleep 1; done
  sleep "${1:-8}"
}

log "fresh install"
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb logcat -c || true
adb install "$APK" || { fail "install failed"; }
adb shell dumpsys package "$PKG" | grep -E "versionCode|versionName|targetSdk|minSdk" | head -4 | tee "$OUT/package.txt"

log "launch"
launch 10
alive || fail "app process not running after launch"
shot 01-launch
INFO=""
if cdp_forward; then
  INFO="$(cdp info 2>&1)"; echo "$INFO" | tee "$OUT/cdp-launch.json"
  echo "$INFO" | grep -q '"titleVisible":true' || fail "WebView did not render the title screen: $INFO"
  echo "$INFO" | grep -q '"hook":"undefined"' || fail "test hook is active in a normal launch: $INFO"
  echo "$INFO" | grep -q '"pid":"[0-9a-f]' || fail "game did not create st-pid in localStorage: $INFO"
else
  fail "no WebView DevTools socket (is the APK debuggable?)"
fi

log "real WebView: play a local CPU round to a winner through the test hook"
if cdp_forward; then
  PLAY="$(timeout 300 node "$HERE/webview-cdp.mjs" "$CDP_PORT" play 2>&1)"; echo "$PLAY" | tee "$OUT/cdp-play.json"
  echo "$PLAY" | grep -q '"ok":true' || fail "CPU round in the WebView did not finish: $PLAY"
  shot 02-round-over
  cdp unflag >/dev/null 2>&1 || true
  sleep 3
fi

log "rotate to landscape and back"
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1; sleep 4; shot 03-landscape
alive || fail "app died on rotation to landscape"
adb shell settings put system user_rotation 0; sleep 4; shot 04-portrait
alive || fail "app died on rotation back to portrait"

log "deep links (offline): invalid code TEST1 is ignored; valid code TEST tries to join and must not crash"
adb shell am start -W -a android.intent.action.VIEW -d "scorchedtanks://join/TEST1" "$PKG" | tee -a "$OUT/am.txt"; sleep 4
alive || fail "app died on scorchedtanks://join/TEST1"
shot 05-deeplink-invalid
if cdp_forward; then
  DL1="$(cdp info 2>&1)"; echo "$DL1" | tee "$OUT/cdp-deeplink-invalid.json"
  echo "$DL1" | grep -q '"online":\[\]' || fail "invalid code TEST1 opened the online panel: $DL1"
fi
adb shell am start -W -a android.intent.action.VIEW -d "scorchedtanks://join/TEST" "$PKG" | tee -a "$OUT/am.txt"; sleep 6
alive || fail "app died on scorchedtanks://join/TEST"
shot 06-deeplink-join-offline
if cdp_forward; then
  DL="$(cdp info 2>&1)"; echo "$DL" | tee "$OUT/cdp-deeplink.json"
  echo "$DL" | grep -q '"netCode":"TEST"' || fail "deep link scorchedtanks://join/TEST did not start a join for room TEST: $DL"
fi

log "reinstall over the installed app (update path): app data must be kept"
MARK="m$(date +%s)"
if cdp_forward; then
  BEFORE="$(cdp set-marker "$MARK" >/dev/null 2>&1; cdp info 2>&1)"; echo "$BEFORE" | tee "$OUT/cdp-before-update.json"
fi
# WebView writes localStorage to disk lazily: background the app and give it time to flush before stopping it
adb shell input keyevent KEYCODE_HOME; sleep 6
adb shell am force-stop "$PKG"
sleep 2
adb install -r "$APK" || fail "reinstall-over (install -r) failed"
launch 8
alive || fail "app not running after update"
shot 07-after-update
if cdp_forward; then
  AFTER="$(cdp info 2>&1)"; echo "$AFTER" | tee "$OUT/cdp-after-update.json"
  echo "$AFTER" | grep -q "\"marker\":\"$MARK\"" || fail "localStorage marker lost across the update: $AFTER"
  pid_before="$(echo "${BEFORE:-}" | sed -n 's/.*"pid":"\([^"]*\)".*/\1/p')"
  pid_after="$(echo "$AFTER" | sed -n 's/.*"pid":"\([^"]*\)".*/\1/p')"
  [ -n "$pid_before" ] && [ "$pid_before" = "$pid_after" ] || fail "st-pid changed across the update ($pid_before -> $pid_after)"
fi

log "back button and pause/resume"
adb shell input keyevent KEYCODE_HOME; sleep 2
adb shell am start -W -n "$ACT" >/dev/null; sleep 3
alive || fail "app died on resume"

log "logcat"
adb logcat -d -v threadtime > "$OUT/logcat.txt" || true
if grep -A3 "FATAL EXCEPTION" "$OUT/logcat.txt" | grep -q "Process: $PKG"; then fail "FATAL EXCEPTION in $PKG (see logcat.txt)"; fi
if grep -q "ANR in $PKG" "$OUT/logcat.txt"; then fail "ANR in $PKG"; fi
grep -E "chromium.*CONSOLE|Console:" "$OUT/logcat.txt" > "$OUT/console.txt" || true
if grep -E "Uncaught" "$OUT/console.txt" > "$OUT/uncaught.txt"; then fail "Uncaught JS errors in the WebView (see uncaught.txt): $(head -n3 "$OUT/uncaught.txt")"; fi

adb forward --remove-all >/dev/null 2>&1 || true
adb shell svc wifi enable >/dev/null 2>&1 || true
log "summary (API $api)"
if [ "${#FAILS[@]}" -gt 0 ]; then printf ' - %s\n' "${FAILS[@]}"; exit 1; fi
echo "all emulator checks passed"
